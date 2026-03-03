const express = require('express');
const router = express.Router();
const validationController = require('../controllers/validationController');
const { protect } = require('../middleware/authMiddleware');

router.post('/arrive', protect, validationController.validateArrival);
// The cron could be unprotected or protected by a specific API key in production, we leave unprotected for demo
router.post('/timeout-cron', validationController.timeoutCron);

module.exports = router;
