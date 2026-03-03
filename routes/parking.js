const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/parkingController');
const bCtrl = require('../controllers/bookingController');
const { protect } = require('../middleware/authMiddleware');

// Public route — all parkings for global map
router.get('/all', ctrl.getAllParkings);

router.use(protect);
router.get('/', ctrl.searchParkings);
router.get('/suggestions', ctrl.getSuggestions);
router.get('/:id', ctrl.getParkingDetails);
router.get('/:id/slots', ctrl.getParkingSlots);

// Slot schedule (which times are booked)
router.get('/slots/:slotId/schedule', bCtrl.getSlotSchedule);

module.exports = router;
