const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const admin = require('firebase-admin');
const serviceAccount = require('./manjh-47d12-2f07b7204d73.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Load environment variables from .env file
dotenv.config();
const firestore = admin.firestore();
const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

// Connect to MongoDB using the URL from the .env file
mongoose.connect(process.env.MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected...'))
  .catch(err => console.log(err));

// Create a user schema and model
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  age: { type: String, required: true },
  email: { type: String, required: true },
  job: { type: String },
  name: { type: String, required: true },
  photoUrl: { type: String },
  pic: { type: String },
  oneSignalId: { type: String },
  rating: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Create User
app.post('/users', async (req, res) => {
  const { id, age, email, job, name, photoUrl, pic, rating, oneSignalId } = req.body;

  if (!id || !name || !email) {
    return res.status(400).json({ message: 'ID, Name, and Email are required', errorCode: 'ERR_MISSING_FIELDS' });
  }

  try {
    const existingUser = await User.findOne({ id });
    if (existingUser) {
      return res.status(409).json({ message: 'User with this ID already exists', errorCode: 'ERR_DUPLICATE_ID' });
    }

    const newUser = new User({
      id, age, email, job, name, photoUrl, pic, rating, oneSignalId
    });

    await newUser.save();
    res.status(201).json(newUser);
  } catch (err) {
    res.status(500).json({ message: 'Server error', errorCode: 'ERR_SERVER', error: err });
  }
});

// Get all users with filters, pagination, and sorting
app.get('/users', async (req, res) => {
  let { name, email, job, minRating, maxRating, page = 1, limit = 10, sortBy = 'name', sortOrder = 'asc' } = req.query;

  try {
    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    let query = {};

    // Apply filters
    if (name) query.name = new RegExp(name, 'i');
    if (email) query.email = new RegExp(email, 'i');
    if (job) query.job = job;
    if (minRating) query.rating = { $gte: parseFloat(minRating) };
    if (maxRating) query.rating = { ...query.rating, $lte: parseFloat(maxRating) };

    // Fetch filtered users
    const users = await User.find(query)
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
      .skip(offset)
      .limit(limit);

    const totalUsers = await User.countDocuments(query);

    if (users.length === 0) {
      return res.status(404).json({ message: 'No users found', errorCode: 'ERR_NO_USERS' });
    }

    res.json({
      totalUsers,
      totalPages: Math.ceil(totalUsers / limit),
      currentPage: page,
      users
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', errorCode: 'ERR_SERVER', error: err });
  }
});

// Get user by ID
app.get('/users/:id', async (req, res) => {
  console.log("Fetching user with ID:", req.params.id); // Debug log
  try {
    const user = await User.findOne({ id: req.params.id });
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: 'User not found', errorCode: 'ERR_USER_NOT_FOUND' });
    }
  } catch (err) {
    console.error(err); // Log the error
    res.status(500).json({ message: 'Server error', errorCode: 'ERR_SERVER', error: err });
  }
});


// Update user by ID
app.put('/users/:id', async (req, res) => {
  try {
    const updatedUser = await User.findOneAndUpdate(
      { id: req.params.id },
      { ...req.body, lastUpdated: new Date() },
      { new: true }
    );

    if (updatedUser) {
      res.json(updatedUser);
    } else {
      res.status(404).json({ message: 'User not found', errorCode: 'ERR_USER_NOT_FOUND' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error', errorCode: 'ERR_SERVER', error: err });
  }
});

// Delete user by ID
app.delete('/users/:id', async (req, res) => {
  try {
    const deletedUser = await User.findOneAndDelete({ id: req.params.id });
    if (deletedUser) {
      res.json(deletedUser);
    } else {
      res.status(404).json({ message: 'User not found', errorCode: 'ERR_USER_NOT_FOUND' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error', errorCode: 'ERR_SERVER', error: err });
  }
});

// Get users excluding left and right swiped users
// Get users excluding left and right swiped users with pagination
app.get('/fetch/users', async (req, res) => {
  const { userId, page = 1, limit = 10 } = req.query;

  console.log("userId", userId);
  if (!userId) {
    return res.status(400).json({ message: 'User ID is required', errorCode: 'ERR_MISSING_USER_ID' });
  }

  try {
    // Fetch left swipes from Firestore
    const passesRef = firestore.collection('tinder_profiles').doc(userId).collection('left_swipes');
    const passesSnapshot = await passesRef.get();
    const passedUserIds = passesSnapshot.docs.map(doc => doc.id);

    // Fetch right swipes from Firestore
    const swipesRef = firestore.collection('tinder_profiles').doc(userId).collection('right_swipes');
    const swipesSnapshot = await swipesRef.get();
    const swipedUserIds = swipesSnapshot.docs.map(doc => doc.id);

    // Combine excluded user IDs (left swipes, right swipes, and the requesting user ID)
    const excludedUserIds = [...passedUserIds, ...swipedUserIds, userId];
    // Fetch users from MongoDB with pagination, excluding the current user and users they've interacted with
    const totalUsers = await User.countDocuments({ id: { $nin: excludedUserIds } });
    const users = await User.find({ id: { $nin: excludedUserIds } })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    if (users.length === 0) {
      return res.status(404).json({ message: 'No available users found', errorCode: 'ERR_NO_USERS_FOUND' });
    }

    res.json({
      totalUsers,
      totalPages: Math.ceil(totalUsers / limit),
      currentPage: parseInt(page),
      users
    });
  } catch (err) {
    console.error(err); // Log the error
    res.status(500).json({ message: 'Server error', errorCode: 'ERR_SERVER', error: err });
  }
});




// Handle any other unmatched routes
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found', errorCode: 'ERR_ROUTE_NOT_FOUND' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

