const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/parkingController');
const { protect } = require('../middleware/authMiddleware');

// Public routes
router.get('/', ctrl.searchParkings);
router.get('/suggestions', ctrl.getSuggestions);
router.get('/:id', ctrl.getParkingDetails);
router.get('/:id/slots', protect, ctrl.getParkingSlots);

module.exports = router;
