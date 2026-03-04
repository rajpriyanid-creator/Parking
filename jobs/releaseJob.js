const Booking = require('../models/Booking');
const Slot = require('../models/Slot');
const WaitingQueue = require('../models/WaitingQueue');
const User = require('../models/User');
const Parking = require('../models/Parking');
const https = require('https');

// ─── Haversine (inline to avoid circular dep) ────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Expo Push Notification helper ────────────────────────────────────────────
function sendExpoPush(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) return;
    const messages = tokens.map(to => ({ to, sound: 'default', title, body, data }));
    const payload = JSON.stringify(messages);
    const options = {
        hostname: 'exp.host',
        path: '/--/api/v2/push/send',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate'
        }
    };
    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try { const r = JSON.parse(data); if (r.data) console.log('[PUSH] Sent:', r.data.length, 'notifications'); }
            catch (e) { }
        });
    });
    req.on('error', (e) => console.error('[PUSH] Error:', e.message));
    req.write(payload);
    req.end();
}

// ─── 1. Release expired RESERVED bookings (no-show) ──────────────────────────
async function releaseExpiredReservations() {
    try {
        const expired = await Booking.find({
            status: 'RESERVED',
            reservedUntil: { $lte: new Date() }
        });

        for (const b of expired) {
            await Slot.findByIdAndUpdate(b.slotId, { status: 'AVAILABLE', currentBookingId: null });
            await Booking.findByIdAndUpdate(b._id, { status: 'RELEASED' });
            console.log(`[CRON] Released booking ${b._id} — slot ${b.slotId} now AVAILABLE`);
            await assignNextFromQueue(b.slotId, b.parkingId);
        }

        if (expired.length > 0) console.log(`[CRON] Released ${expired.length} expired reservations`);
    } catch (err) {
        console.error('[CRON] Error releasing reservations:', err.message);
    }
}

// ─── 2. Push notification 15 min before booking start ─────────────────────────
async function sendPreBookingNotifications() {
    try {
        const now = new Date();
        const in15 = new Date(now.getTime() + 15 * 60000); // 15 min from now
        const in16 = new Date(now.getTime() + 16 * 60000); // upper bound window

        // Find SCHEDULED bookings starting in the next 15–16 min (or within 2 min — send immediately)
        const upcoming = await Booking.find({
            status: 'SCHEDULED',
            notificationSentAt: null,
            $or: [
                // ~15 min window: startTime between (now+14min) and (now+16min)
                { scheduledStartTime: { $gte: new Date(now.getTime() + 14 * 60000), $lte: in16 } },
                // Immediate: starting within next 2 min (pre-book that starts very soon)
                { scheduledStartTime: { $lte: new Date(now.getTime() + 2 * 60000) } }
            ]
        }).populate('userId', 'fcmToken name')
            .populate('slotId', 'slotNumber')
            .populate('parkingId', 'name address');

        for (const b of upcoming) {
            const token = b.userId?.fcmToken;
            if (!token) {
                // Still mark as sent so we don't retry forever
                await Booking.findByIdAndUpdate(b._id, { notificationSentAt: now });
                continue;
            }

            const parkingName = b.parkingId?.name || 'your parking';
            const address = b.parkingId?.address || '';
            const slotNo = b.slotId?.slotNumber || '?';
            const minsUntil = Math.round((new Date(b.scheduledStartTime) - now) / 60000);

            const title = minsUntil <= 2 ? '🅿️ Your parking starts now!' : `🅿️ Parking in ~${minsUntil} min`;
            const body = `Slot ${slotNo} at ${parkingName}${address ? ' · ' + address : ''} | ${new Date(b.scheduledStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${new Date(b.scheduledEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

            sendExpoPush([token], title, body, { bookingId: b._id.toString(), screen: 'MyBookings' });
            await Booking.findByIdAndUpdate(b._id, { notificationSentAt: now });
            console.log(`[PUSH] Sent reminder to user ${b.userId?._id} for booking ${b._id}`);
        }
    } catch (err) {
        console.error('[CRON] Push notification error:', err.message);
    }
}

// ─── 3. GPS auto-release: if booking just started and driver is too far ────────
const GPS_RELEASE_RADIUS_M = 2000;        // 2km — can't reach in time
const GPS_STALE_THRESHOLD_MS = 10 * 60000; // ignore locations older than 10 min

async function checkStartTimeGpsRelease() {
    try {
        const now = new Date();
        const twoMinAgo = new Date(now.getTime() - 2 * 60000);

        // Find SCHEDULED bookings whose start time just passed (within last 2 min)
        const justStarted = await Booking.find({
            status: 'SCHEDULED',
            scheduledStartTime: { $gte: twoMinAgo, $lte: now }
        }).populate('userId', 'lastKnownLat lastKnownLng lastLocationAt fcmToken name')
            .populate('slotId', 'slotNumber')
            .populate('parkingId', 'name address location');

        for (const b of justStarted) {
            const user = b.userId;
            // Skip if no location data
            if (!user?.lastKnownLat || !user?.lastKnownLng) {
                console.log(`[GPS-RELEASE] No location for user ${user?._id}, skipping booking ${b._id}`);
                continue;
            }
            // Skip if location is stale (>10 min old)
            const locationAge = now - new Date(user.lastLocationAt || 0);
            if (locationAge > GPS_STALE_THRESHOLD_MS) {
                console.log(`[GPS-RELEASE] Stale location (${Math.round(locationAge / 60000)} min old) for booking ${b._id}, skipping`);
                continue;
            }

            const parking = b.parkingId;
            if (!parking?.location) continue;

            const dist = haversine(user.lastKnownLat, user.lastKnownLng, parking.location.lat, parking.location.lng);
            console.log(`[GPS-RELEASE] Booking ${b._id}: driver is ${Math.round(dist)}m from ${parking.name}`);

            if (dist > GPS_RELEASE_RADIUS_M) {
                // Driver is too far — release the slot
                await Slot.findByIdAndUpdate(b.slotId._id, { status: 'AVAILABLE', currentBookingId: null });
                await Booking.findByIdAndUpdate(b._id, { status: 'RELEASED' });
                console.log(`[GPS-RELEASE] Released booking ${b._id} — driver ${Math.round(dist)}m away`);

                // Notify driver
                if (user.fcmToken) {
                    const slotNo = b.slotId?.slotNumber || '?';
                    sendExpoPush(
                        [user.fcmToken],
                        '⚠️ Slot Released',
                        `Slot ${slotNo} at ${parking.name} was released — you appear to be ${Math.round(dist / 1000)}km away.`,
                        { bookingId: b._id.toString(), screen: 'MyBookings' }
                    );
                }

                await assignNextFromQueue(b.slotId._id, b.parkingId._id);
            }
        }
    } catch (err) {
        console.error('[CRON] GPS release error:', err.message);
    }
}

// ─── 4. Auto-complete bookings whose scheduled end time has passed ─────────────
async function autoCompleteExpiredBookings() {
    try {
        const now = new Date();
        const expired = await Booking.find({
            status: 'OCCUPIED',
            scheduledEndTime: { $lte: now }
        });
        for (const b of expired) {
            await Booking.findByIdAndUpdate(b._id, { status: 'COMPLETED' });
            await Slot.findByIdAndUpdate(b.slotId, { status: 'AVAILABLE', currentBookingId: null });
            console.log(`[CRON] Auto-completed booking ${b._id}`);
            await assignNextFromQueue(b.slotId, b.parkingId);
        }
    } catch (err) {
        console.error('[CRON] Auto-complete error:', err.message);
    }
}

// ─── Queue helper ──────────────────────────────────────────────────────────────
async function assignNextFromQueue(slotId, parkingId) {
    const next = await WaitingQueue.findOne({ slotId }).sort({ requestedAt: 1 });
    if (!next) return;

    const slot = await Slot.findById(slotId);
    if (!slot || slot.status !== 'AVAILABLE') return;

    // EV priority check
    if (next.vehicleType === 'Petrol' && slot.slotType === 'EV') {
        const normalAvail = await Slot.countDocuments({ parkingId, slotType: 'NORMAL', status: 'AVAILABLE' });
        if (normalAvail > 0) {
            await WaitingQueue.findByIdAndDelete(next._id);
            return;
        }
    }

    const now = new Date();
    const reservedUntil = new Date(now.getTime() + 15 * 60000);
    const { totalPrice } = calculatePrice(slot, next.durationHours || 2);

    const booking = await Booking.create({
        userId: next.userId,
        slotId,
        parkingId,
        vehicleType: next.vehicleType,
        bookingStartTime: now,
        scheduledStartTime: now,
        scheduledEndTime: new Date(now.getTime() + (next.durationHours || 2) * 3600000),
        durationHours: next.durationHours || 2,
        totalPrice,
        status: 'RESERVED',
        reservedUntil
    });

    await Slot.findByIdAndUpdate(slotId, { status: 'RESERVED', currentBookingId: booking._id });
    await WaitingQueue.findByIdAndDelete(next._id);
    console.log(`[CRON] Auto-assigned slot ${slotId} to user ${next.userId} from waiting queue`);
}

function calculatePrice(slot, durationHours) {
    const premium = slot.entryPriority === 'PREMIUM' ? (slot.premiumExtraPerHour || 0) : 0;
    const totalPrice = (slot.basePricePerHour + premium) * durationHours;
    return { totalPrice: parseFloat(totalPrice.toFixed(2)) };
}

module.exports = {
    releaseExpiredReservations,
    sendPreBookingNotifications,
    checkStartTimeGpsRelease,
    autoCompleteExpiredBookings
};
