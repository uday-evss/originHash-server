const axios = require("axios");

const TWO_FACTOR_BASE_URL = "https://2factor.in/API/V1";

/**
 * Send OTP using 2Factor
 */
// const sendOtp222 = async (mobile) => {
//   try {
//     const apiKey = process.env.TWO_FACTOR_API_KEY;

//     if (!apiKey) {
//       throw new Error(
//         "TWO_FACTOR_API_KEY is missing in environment variables.",
//       );
//     }

//     const url = `${TWO_FACTOR_BASE_URL}/${apiKey}/SMS/${mobile}/AUTOGEN`;

//     const response = await axios.get(url);

//     console.log("2Factor Send OTP Response:", response.data);

//     return response.data;
//   } catch (error) {
//     console.error(
//       "2Factor Send OTP Error:",
//       error.response?.data || error.message,
//     );

//     throw new Error(
//       error.response?.data?.Details ||
//         error.response?.data?.message ||
//         "Failed to send OTP",
//     );
//   }
// };


const sendOtp222 = async (mobile) => {
  try {
    const apiKey = process.env.TWO_FACTOR_API_KEY;

    const url = `https://2factor.in/API/V1/${apiKey}/SMS/${mobile}/AUTOGEN`;

    const response = await axios.get(url);

    console.log("2Factor response:", response.data);

    return response.data;
  } catch (error) {
    console.error("2Factor error:", error.response?.data || error.message);

    throw error;
  }
};


/**
 * Verify OTP using 2Factor
 */
const verifyOtp222 = async (sessionId, otp) => {
  try {
    const apiKey = process.env.TWO_FACTOR_API_KEY;

    if (!apiKey) {
      throw new Error(
        "TWO_FACTOR_API_KEY is missing in environment variables.",
      );
    }

    const url = `${TWO_FACTOR_BASE_URL}/${apiKey}/SMS/VERIFY/${sessionId}/${otp}`;

    const response = await axios.get(url);

    console.log("2Factor Verify OTP Response:", response.data);

    return response.data;
  } catch (error) {
    console.error(
      "2Factor Verify OTP Error:",
      error.response?.data || error.message,
    );

    throw new Error(
      error.response?.data?.Details ||
        error.response?.data?.message ||
        "Failed to verify OTP",
    );
  }
};

module.exports = {
  sendOtp222,
  verifyOtp222,
};
