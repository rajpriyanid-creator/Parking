const Parking = require('../models/Parking');
const Slot = require('../models/Slot');
const Booking = require('../models/Booking');
const haversine = require('../utils/haversine');

// GET /api/parkings?lat=&lng=&radius=&q=
exports.searchParkings = async (req, res) => {
    try {
        let { lat, lng, radius = 5000, q } = req.query;
        lat = parseFloat(lat); lng = parseFloat(lng);

        let query = {};
        if (q) query.name = { $regex: q, $options: 'i' };

        const allParkings = await Parking.find(query);
        let results = allParkings
            .map(p => {
                const dist = (!isNaN(lat) && !isNaN(lng))
                    ? haversine(lat, lng, p.location.lat, p.location.lng)
                    : null;
                return { parking: p, distanceMeters: dist };
            })
            .filter(p => p.distanceMeters === null || p.distanceMeters <= parseFloat(radius))
            .sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));

        // Annotate each with slot counts
        const annotated = await Promise.all(results.map(async ({ parking, distanceMeters }) => {
            const slots = await Slot.find({ parkingId: parking._id });
            const available = slots.filter(s => s.status === 'AVAILABLE').length;
            const evAvailable = slots.filter(s => s.status === 'AVAILABLE' && s.slotType === 'EV').length;
            const total = slots.length;
            const occupancyRate = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
            return {
                parking,
                distanceMeters: distanceMeters ? Math.round(distanceMeters) : null,
                availableSlots: available,
                evAvailableSlots: evAvailable,
                totalSlots: total,
                occupancyRate
            };
        }));

        res.json(annotated);
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

// GET /api/parkings/:id/slots (with EV priority sort)
exports.getParkingSlots = async (req, res) => {
    try {
        const { vehicleType } = req.query;
        let slots = await Slot.find({ parkingId: req.params.id }).sort({ slotType: -1, entryPriority: 1 });

        // For normal vehicles, filter out EV slots if normal slots exist
        if (vehicleType === 'Petrol') {
            const normalAvail = slots.filter(s => s.slotType === 'NORMAL' && s.status === 'AVAILABLE').length;
            if (normalAvail > 0) {
                slots = slots.filter(s => s.slotType === 'NORMAL');
            }
        }
        res.json(slots);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/suggestions?lat=&lng=&areaId=
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

        const filtered = suggestions
            .filter(Boolean)
            .filter(s => s.availableSlots > 0)
            .sort((a, b) => a.distanceMeters - b.distanceMeters);

        res.json(filtered);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
