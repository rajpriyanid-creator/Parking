const Booking = require('../models/Booking');
const Slot = require('../models/Slot');
const Parking = require('../models/Parking');

// Haversine formula
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

exports.validateArrival = async (req, res) => {
    try {
        const { bookingId, lat, lng } = req.body;

        const booking = await Booking.findById(bookingId).populate({
            path: 'slotId',
            populate: { path: 'parkingId' }
        });

        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        if (booking.status !== 'Reserved') return res.status(400).json({ message: `Booking is already ${booking.status}` });

        const parking = booking.slotId.parkingId;

        const distanceKm = getDistanceFromLatLonInKm(lat, lng, parking.location.latitude, parking.location.longitude);
        const distanceMeters = distanceKm * 1000;

        if (distanceMeters <= 100) {
            // Validated!
            booking.status = 'Occupied';
            await booking.save();

            const slot = await Slot.findById(booking.slotId._id);
            slot.status = 'Occupied';
            await slot.save();

            return res.json({ message: 'Arrival validated. Slot is now Occupied.', distanceMeters, success: true });
        } else {
            return res.json({ message: 'You are too far away from the parking location.', distanceMeters, success: false });
        }

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.timeoutCron = async (req, res) => {
    // This would typically be called by a cron job periodically.
    try {
        // Find bookings that are 'Reserved' but older than 15 minutes
        const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);

        const expiredBookings = await Booking.find({
            status: 'Reserved',
            bookingTime: { $lt: fifteenMinsAgo }
        });

        let releases = 0;

        for (const booking of expiredBookings) {
            booking.status = 'Released';
            await booking.save();

            const slot = await Slot.findById(booking.slotId);
            if (slot) {
                slot.status = 'Available';
                await slot.save();
            }
            releases++;
        }

        res.json({ message: `Cron executed. Released ${releases} expired bookings.` });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}
