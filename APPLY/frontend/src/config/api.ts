// API Configuration
const API_CONFIG = {
  // Use environment variable if available, otherwise use production backend
  baseURL: process.env.REACT_APP_API_URL || 'https://backend1.gowiser.ph',

  // For local development, you can override this
  // baseURL: 'http://localhost:8000',
};

export default API_CONFIG;
