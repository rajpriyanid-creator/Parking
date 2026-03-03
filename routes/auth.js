const express = require('express');
const router = express.Router();
const { register, login, getProfile, updateFCMToken } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', register);
router.post('/login', login);
router.get('/profile', protect, getProfile);
router.put('/fcm-token', protect, updateFCMToken);

module.exports = router;
