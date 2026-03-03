const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    vehicle: {
        type: { type: String, enum: ['EV', 'Petrol'], default: 'Petrol' },
        number: { type: String }
    },
    fcmToken: { type: String }, // for push notifications
    lastKnownLat: { type: Number },
    lastKnownLng: { type: Number },
    lastLocationAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
