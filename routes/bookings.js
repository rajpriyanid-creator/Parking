const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/bookingController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/my', ctrl.getMyBookings);
router.get('/price-preview', ctrl.pricePreview);
router.post('/', ctrl.createBooking);
router.get('/:id', ctrl.getBooking);
router.post('/:id/confirm-arrival', ctrl.confirmArrival);
router.post('/:id/cancel', ctrl.cancelBooking);
router.post('/:id/complete', ctrl.completeBooking);

module.exports = router;
