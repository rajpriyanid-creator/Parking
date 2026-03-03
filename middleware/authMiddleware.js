const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

exports.protect = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
        return res.status(401).json({ message: 'No token provided' });

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { userId, role, vehicleType }
        next();
    } catch (e) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

exports.adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin')
        return res.status(403).json({ message: 'Admin access required' });
    next();
};
