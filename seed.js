require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Parking = require('./models/Parking');
const Slot = require('./models/Slot');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smartparking';

async function seed() {
    await mongoose.connect(MONGO_URI);
    console.log('Connected. Seeding...');

    // Clear existing
    await User.deleteMany({});
    await Parking.deleteMany({});
    await Slot.deleteMany({});

    const passwordHash = await bcrypt.hash('password123', 10);

    // Create Admin
    const admin = await User.create({
        name: 'Admin User', email: 'admin@demo.com', phone: '9999999999',
        passwordHash, role: 'admin',
        vehicle: { type: 'Petrol', number: 'ADM-001' }
    });

    // Create Drivers
    await User.create({
        name: 'Petrol Driver', email: 'driver1@demo.com', phone: '8888888881',
        passwordHash, role: 'user',
        vehicle: { type: 'Petrol', number: 'CAR-111' }
    });
    await User.create({
        name: 'EV Driver', email: 'driver2@demo.com', phone: '8888888882',
        passwordHash, role: 'user',
        vehicle: { type: 'EV', number: 'EV-999' }
    });

    // Create Parking - Central Mall
    const parking = await Parking.create({
        name: 'Central Mall Parking',
        description: 'Multi-level parking at Central Mall — EV-ready!',
        adminId: admin._id,
        location: { lat: 12.9716, lng: 77.5946 }, // Bangalore coords
        address: 'Central Mall, MG Road, Bangalore',
        totalSlots: 20
    });

    // Create 12 Normal Slots
    const normalSlots = [];
    for (let i = 1; i <= 12; i++) {
        normalSlots.push({
            parkingId: parking._id,
            slotNumber: `N-${String(i).padStart(2, '0')}`,
            slotType: 'NORMAL',
            entryPriority: i <= 4 ? 'PREMIUM' : 'STANDARD',
            chargingType: 'NONE',
            basePricePerHour: 5,
            premiumExtraPerHour: i <= 4 ? 3 : 0,
            status: 'AVAILABLE'
        });
    }

    // Create 8 EV Slots
    for (let i = 1; i <= 8; i++) {
        normalSlots.push({
            parkingId: parking._id,
            slotNumber: `EV-${String(i).padStart(2, '0')}`,
            slotType: 'EV',
            entryPriority: 'STANDARD',
            chargingType: i <= 4 ? 'FAST' : 'NORMAL',
            basePricePerHour: 7,
            premiumExtraPerHour: 0,
            status: 'AVAILABLE'
        });
    }

    await Slot.insertMany(normalSlots);

    console.log('✅ Seeded successfully!');
    console.log('\n📧 Login credentials:');
    console.log('  Admin:   admin@demo.com   / password123');
    console.log('  Driver1: driver1@demo.com / password123 (Petrol)');
    console.log('  Driver2: driver2@demo.com / password123 (EV)');

    await mongoose.disconnect();
    process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
