const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, Otp } = require('../models');
const { generateOtp } = require('../utils/otp');
const { sendOtp222, verifyOtp222 } = require("../services/twoFactorService");


// const MOBILE_REGEX = /^[6-9]\d{9}$/;

// const signToken = (user) =>
//   jwt.sign({ id: user.id, isAdmin: user.isAdmin }, process.env.JWT_SECRET, {
//     expiresIn: process.env.JWT_EXPIRES_IN || '7d',
//   });

// const publicUser = (user) => ({
//   id: user.id,
//   mobile: user.mobile,
//   countryCode: user.countryCode,
//   name: user.name,
//   email: user.email,
//   photoUrl: user.photoUrl,
//   userType: user.userType,
//   address: user.address,
//   isAdmin: user.isAdmin,
//   isBlocked: user.isBlocked,
//   profileCompleted: user.profileCompleted,
//   scansCount: user.scansCount,
// });

// // POST /api/auth/send-otp  { mobile }
// const sendOtp = async (req, res) => {
//   try {
//     const { mobile } = req.body;

//     if (!mobile || !MOBILE_REGEX.test(mobile)) {
//       return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
//     }

//     let user = await User.findOne({ where: { mobile } });

//     if (user && user.isBlocked) {
//       return res
//         .status(403)
//         .json({ message: 'This account has been blocked. Contact the admin for help.' });
//     }

//     // The seed Admin account always uses the fixed demo OTP from .env
//     const isAdminMobile = mobile === process.env.ADMIN_MOBILE;
//     const otpCode = isAdminMobile ? process.env.ADMIN_OTP : generateOtp(Number(process.env.OTP_LENGTH) || 4);

//     const expiresAt = new Date(
//       Date.now() + (Number(process.env.OTP_EXPIRES_MINUTES) || 5) * 60 * 1000
//     );

//     await Otp.create({ mobile, otpCode, expiresAt, isUsed: false });

//     // If this is a brand-new normal user, create a bare record now so
//     // the admin's user list and future login attempts have a row to work with.
//     if (!user) {
//       user = await User.create({
//         mobile,
//         countryCode: '+91',
//         isAdmin: false,
//         isBlocked: false,
//         profileCompleted: false,
//       });
//     }

//     // NOTE: No SMS provider is wired up yet (2Factor to be added later).
//     // For now we return the OTP in the response so the frontend can display
//     // it on screen, simulating an SMS.
//     return res.status(200).json({
//       message: 'OTP generated.',
//       mobile,
//       demoOtp: otpCode,
//       isNewUser: !user.profileCompleted,
//     });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ message: 'Could not generate OTP. Please try again.' });
//   }
// };



const MOBILE_REGEX = /^[6-9]\d{9}$/;

const signToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      isAdmin: user.isAdmin,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
  );

const publicUser = (user) => ({
  id: user.id,
  mobile: user.mobile,
  countryCode: user.countryCode,
  username: user.username,
  name: user.name,
  email: user.email,
  photoUrl: user.photoUrl,
  userType: user.userType,
  address: user.address,
  isAdmin: user.isAdmin,
  isSuperAdmin: user.isSuperAdmin,
  isBlocked: user.isBlocked,
  profileCompleted: user.profileCompleted,
  scansCount: user.scansCount,
});

// POST /api/auth/send-otp
const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile || !MOBILE_REGEX.test(mobile)) {
      return res.status(400).json({
        message: "Enter a valid 10-digit mobile number.",
      });
    }

    let user = await User.findOne({
      where: { mobile },
    });

    if (user && user.isAdmin) {
      return res.status(403).json({
        message: "Admin accounts log in with a username and password, not OTP.",
      });
    }

    if (user && user.isBlocked) {
      return res.status(403).json({
        message: "This account has been blocked. Contact the admin for help.",
      });
    }

    // Create user if new
    if (!user) {
      user = await User.create({
        mobile,
        countryCode: "+91",
        isAdmin: false,
        isBlocked: false,
        profileCompleted: false,
      });
    }

    // Send OTP via 2Factor
    const result = await sendOtp222(mobile);

    console.log("2Factor OTP response:", result);

    // Check 2Factor response
    if (!result || String(result.Status).toLowerCase() !== "success") {
      return res.status(502).json({
        message: result?.Details || "Unable to send OTP.",
      });
    }

    return res.status(200).json({
      message: "OTP sent successfully.",
      mobile,

      // This is the session ID returned by 2Factor
      sessionId: result.Details,

      isNewUser: !user.profileCompleted,
    });
  } catch (err) {
    console.error("Send OTP Error:", err);

    return res.status(500).json({
      message: err.message || "Could not send OTP. Please try again.",
    });
  }
};

// POST /api/auth/verify-otp  { mobile, otp }
// POST /api/auth/verify-otp
const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, sessionId } = req.body;

    if (!mobile || !otp || !sessionId) {
      return res.status(400).json({
        message: "Mobile number, OTP and session ID are required.",
      });
    }

    // Verify OTP with 2Factor
    const result = await verifyOtp222(sessionId, otp);

    console.log("2Factor Verify Response:", result);

    // Check if OTP verification was successful
    const isSuccess =
      result &&
      String(result.Status).toLowerCase() === "success" &&
      String(result.Details).toLowerCase().includes("matched");

    if (!isSuccess) {
      return res.status(400).json({
        message: result?.Details || "Incorrect or expired OTP.",
      });
    }

    const user = await User.findOne({
      where: { mobile },
    });

    if (!user) {
      return res.status(404).json({
        message: "Account not found.",
      });
    }

    if (user.isAdmin) {
      return res.status(403).json({
        message: "Admin accounts log in with a username and password, not OTP.",
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        message:
          "This account has been blocked. Contact the admin for help.",
      });
    }

    const token = signToken(user);

    return res.status(200).json({
      message: "Logged in successfully.",
      token,
      user: publicUser(user),
    });

  } catch (err) {
    console.error("Verify OTP Error:", err);

    return res.status(500).json({
      message: err.message || "Could not verify OTP. Please try again.",
    });
  }
};

// POST /api/auth/admin-login  { username, password }
const adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username?.trim() || !password) {
      return res.status(400).json({ message: "Username and password are required." });
    }

    const user = await User.findOne({ where: { username: username.trim(), isAdmin: true } });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    if (user.isBlocked) {
      return res.status(403).json({ message: "This account has been blocked." });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const token = signToken(user);

    return res.status(200).json({
      message: "Logged in successfully.",
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error("Admin Login Error:", err);
    return res.status(500).json({ message: err.message || "Could not log in. Please try again." });
  }
};

module.exports = { sendOtp, verifyOtp, adminLogin, publicUser };
