const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.use(protect, adminOnly);

router.get('/dashboard', ctrl.getDashboardStats);

// Parking management
router.post('/parkings', ctrl.createParking);
router.get('/parkings', ctrl.getMyParkings);
router.get('/parkings/:id/bookings', ctrl.getParkingBookings);

// Slot management
router.post('/parkings/:id/slots', ctrl.addSlot);
router.put('/slots/:slotId', ctrl.updateSlot);
router.delete('/slots/:slotId', ctrl.deleteSlot);
router.post('/slots/:slotId/release', ctrl.forceReleaseSlot);

module.exports = router;
