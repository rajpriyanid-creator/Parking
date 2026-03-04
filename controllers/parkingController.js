const Parking = require('../models/Parking');
const Slot = require('../models/Slot');
const Booking = require('../models/Booking');
const haversine = require('../utils/haversine');

// GET /api/parkings?lat=&lng=&radius=&q=
exports.searchParkings = async (req, res) => {
    try {
        let { lat, lng, radius = 50000, q } = req.query;
        lat = parseFloat(lat); lng = parseFloat(lng);
        const hasCoords = !isNaN(lat) && !isNaN(lng);

        let query = {};
        if (q) query.name = { $regex: q, $options: 'i' };

        const allParkings = await Parking.find(query);
        let results = allParkings.map(p => {
            const dist = hasCoords ? haversine(lat, lng, p.location.lat, p.location.lng) : null;
            return { parking: p, distanceMeters: dist };
        });

        // If coords provided, sort by distance (no radius limit by default)
        if (hasCoords) {
            results = results
                .filter(p => p.distanceMeters <= parseFloat(radius))
                .sort((a, b) => a.distanceMeters - b.distanceMeters);
        }

        // Annotate with live slot counts
        const annotated = await Promise.all(results.map(async ({ parking, distanceMeters }) => {
            const slots = await Slot.find({ parkingId: parking._id });
            const available = slots.filter(s => s.status === 'AVAILABLE').length;
            const evAvailable = slots.filter(s => s.status === 'AVAILABLE' && s.slotType === 'EV').length;
            const bikeAvailable = slots.filter(s => s.status === 'AVAILABLE' && s.slotType === 'BIKE').length;
            const total = slots.length;
            const occupancyRate = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
            const minPrice = slots.length > 0 ? Math.min(...slots.map(s => s.basePricePerHour)) : 0;
            return {
                parking,
                distanceMeters: distanceMeters ? Math.round(distanceMeters) : null,
                availableSlots: available,
                evAvailableSlots: evAvailable,
                bikeAvailableSlots: bikeAvailable,
                totalSlots: total,
                occupancyRate,
                minPricePerHour: minPrice
            };
        }));

        res.json(annotated);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/parkings/all  — all parkings for map (no auth needed)
exports.getAllParkings = async (req, res) => {
    try {
        const allParkings = await Parking.find({});
        const result = await Promise.all(allParkings.map(async (parking) => {
            const slots = await Slot.find({ parkingId: parking._id });
            const available = slots.filter(s => s.status === 'AVAILABLE').length;
            const evAvailable = slots.filter(s => s.status === 'AVAILABLE' && s.slotType === 'EV').length;
            const bikeAvailable = slots.filter(s => s.status === 'AVAILABLE' && s.slotType === 'BIKE').length;
            const total = slots.length;
            const minPrice = slots.length > 0 ? Math.min(...slots.map(s => s.basePricePerHour)) : 0;
            return {
                parking,
                availableSlots: available,
                evAvailableSlots: evAvailable,
                bikeAvailableSlots: bikeAvailable,
                totalSlots: total,
                occupancyRate: total > 0 ? Math.round(((total - available) / total) * 100) : 0,
                minPricePerHour: minPrice
            };
        }));
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/parkings/:id
exports.getParkingDetails = async (req, res) => {
    try {
        const parking = await Parking.findById(req.params.id);
        if (!parking) return res.status(404).json({ message: 'Parking not found' });
        const slots = await Slot.find({ parkingId: req.params.id });
        const available = slots.filter(s => s.status === 'AVAILABLE').length;
        const evAvail = slots.filter(s => s.status === 'AVAILABLE' && s.slotType === 'EV').length;
        res.json({ parking, slots, availableSlots: available, evAvailableSlots: evAvail });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/parkings/:id/slots
exports.getParkingSlots = async (req, res) => {
    try {
        const { vehicleType } = req.query;
        let slots = await Slot.find({ parkingId: req.params.id }).sort({ slotType: -1, entryPriority: 1 });

        // Add "next available time" annotation for each slot
        const now = new Date();
        const annotated = await Promise.all(slots.map(async (slot) => {
            const activeBooking = await Booking.findOne({
                slotId: slot._id,
                status: { $in: ['SCHEDULED', 'RESERVED', 'OCCUPIED'] },
                scheduledStartTime: { $lte: new Date(now.getTime() + 3600000) },
                scheduledEndTime: { $gt: now }
            }).sort({ scheduledEndTime: -1 });

            return {
                ...slot.toObject(),
                nextFreeAt: activeBooking ? activeBooking.scheduledEndTime : null
            };
        }));

        // Vehicle type filter — prefer matching slot type when available
        if (vehicleType === 'Petrol') {
            const normalAvail = annotated.filter(s => s.slotType === 'NORMAL' && s.status === 'AVAILABLE').length;
            if (normalAvail > 0) return res.json(annotated.filter(s => s.slotType === 'NORMAL'));
        } else if (vehicleType === 'Bike') {
            const bikeAvail = annotated.filter(s => s.slotType === 'BIKE' && s.status === 'AVAILABLE').length;
            if (bikeAvail > 0) return res.json(annotated.filter(s => s.slotType === 'BIKE'));
            // fallback to NORMAL if no bike slots
            return res.json(annotated.filter(s => s.slotType === 'NORMAL'));
        }

        res.json(annotated);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/parkings/suggestions
exports.getSuggestions = async (req, res) => {
    try {
        let { lat, lng, areaId } = req.query;
        lat = parseFloat(lat); lng = parseFloat(lng);
        const SUGGESTION_RADIUS_M = 3000;

        const allParkings = await Parking.find(areaId ? { _id: { $ne: areaId } } : {});
        const suggestions = await Promise.all(allParkings.map(async (p) => {
            const dist = haversine(lat, lng, p.location.lat, p.location.lng);
            if (dist > SUGGESTION_RADIUS_M) return null;
            const slots = await Slot.find({ parkingId: p._id });
            const available = slots.filter(s => s.status === 'AVAILABLE').length;
            const evAvail = slots.filter(s => s.status === 'AVAILABLE' && s.slotType === 'EV').length;
            const minPrice = slots.reduce((min, s) => s.basePricePerHour < min ? s.basePricePerHour : min, Infinity);
            return { parking: p, distanceMeters: Math.round(dist), availableSlots: available, evAvailableSlots: evAvail, minPricePerHour: minPrice === Infinity ? 0 : minPrice };
        }));

        const filtered = suggestions.filter(Boolean).filter(s => s.availableSlots > 0).sort((a, b) => a.distanceMeters - b.distanceMeters);
        res.json(filtered);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
