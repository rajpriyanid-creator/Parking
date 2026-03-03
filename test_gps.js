const axios = require('axios');

const API_URL = 'http://localhost:5000/api';

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runGPSValidationTest() {
    console.log('--- STARTING GPS VALIDATION FLOW TEST ---');

    try {
        // 1. Log in as a driver
        console.log('\n[1] Logging in as driver1@demo.com...');
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: 'driver1@demo.com',
            password: 'password123'
        });
        const token = loginRes.data.token;
        const headers = { Authorization: `Bearer ${token}` };
        console.log('✅ Logged in successfully.');

        // 2. Fetch parkings
        console.log('\n[2] Fetching nearby parkings...');
        // Using Bangalore coordinates
        const parkingsRes = await axios.get(`${API_URL}/parkings?lat=12.9716&lng=77.5946`);
        const parking = parkingsRes.data[0].parking;
        console.log(`✅ Found parking: ${parking.name}`);
        console.log(`   Location: Lat ${parking.location.lat}, Lng ${parking.location.lng}`);

        // 3. Fetch slots for this parking
        console.log(`\n[3] Fetching slots for ${parking.name}...`);
        const slotsRes = await axios.get(`${API_URL}/parkings/${parking._id}/slots`, { headers });
        const availableSlot = slotsRes.data.find(s => s.status === 'AVAILABLE' && s.slotType === 'NORMAL'); // Driver 1 is Petrol

        if (!availableSlot) {
            console.log('❌ No available normal slots found. Cannot proceed.');
            return;
        }
        console.log(`✅ Found available slot: ${availableSlot.slotNumber} (Type: ${availableSlot.slotType})`);

        // 4. Book the slot
        console.log('\n[4] Booking the slot...');
        const bookRes = await axios.post(`${API_URL}/bookings`, {
            slotId: availableSlot._id,
            vehicleType: 'Petrol',
            durationHours: 2
        }, { headers });
        const bookingId = bookRes.data.booking._id;
        console.log(`✅ Slot booked! Booking ID: ${bookingId}`);
        console.log(`   Total Price (with premium if applicable): ₹${bookRes.data.booking.totalPrice}`);

        // 5. Attempt GPS Validation - OUTSIDE RADIUS (e.g. 1km away)
        // 1 degree lat is ~111km, so 0.01 is ~1.1km
        console.log('\n[5] Simulating GPS Validation - User is FAR AWAY (1.1km)...');
        const farLat = parking.location.lat + 0.01;
        const farLng = parking.location.lng;
        try {
            const farRes = await axios.post(`${API_URL}/bookings/${bookingId}/confirm-arrival`, {
                lat: farLat,
                lng: farLng
            }, { headers });

            if (farRes.data.ok) {
                console.log('❌ UNEXPECTED: Server accepted far coordinates.');
            } else {
                console.log(`✅ Access Denied as expected: ${farRes.data.reason}`);
                console.log(`   Distance calculated by server: ${farRes.data.distanceMeters}m (Allowed <= 100m)`);
            }
        } catch (e) {
            console.log('Error during far validation:', e.response?.data?.message || e.message);
        }

        await delay(2000); // pause for readability

        // 6. Attempt GPS Validation - INSIDE RADIUS (e.g. at the exact spot)
        console.log('\n[6] Simulating GPS Validation - User is AT THE ENTRANCE...');
        const nearLat = parking.location.lat + 0.0001; // ~11 meters away
        const nearLng = parking.location.lng;
        const nearRes = await axios.post(`${API_URL}/bookings/${bookingId}/confirm-arrival`, {
            lat: nearLat,
            lng: nearLng
        }, { headers });

        if (nearRes.data.ok) {
            console.log(`✅ Success! ${nearRes.data.message}`);
            console.log(`   Distance calculated by server: ${nearRes.data.distanceMeters}m (Allowed <= 100m)`);
        } else {
            console.log(`❌ Failed: ${nearRes.data.reason}`);
        }

        // 7. Verify final slot status
        console.log('\n[7] Verifying final booking status...');
        const finalBookingRes = await axios.get(`${API_URL}/bookings/${bookingId}`, { headers });
        console.log(`✅ Booking Status is now: ${finalBookingRes.data.status} (Should be OCCUPIED)`);
        console.log('--- TEST COMPLETE ---');

    } catch (err) {
        console.error('Test failed:', err.response?.data || err.message);
    }
}

runGPSValidationTest();
