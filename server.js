require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smartparking';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');

    const {
      releaseExpiredReservations,
      sendPreBookingNotifications,
      checkStartTimeGpsRelease,
      autoCompleteExpiredBookings
    } = require('./jobs/releaseJob');

    // Run every minute
    setInterval(releaseExpiredReservations, 60 * 1000);
    setInterval(sendPreBookingNotifications, 60 * 1000);
    setInterval(checkStartTimeGpsRelease, 60 * 1000);
    setInterval(autoCompleteExpiredBookings, 60 * 1000);

    // Run immediately on start too
    releaseExpiredReservations();
    sendPreBookingNotifications();
    autoCompleteExpiredBookings();

    console.log('[CRON] All jobs started (every 60s)');
  })
  .catch(err => console.log('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/parkings', require('./routes/parking'));
app.use('/api/bookings', require('./routes/bookings'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
