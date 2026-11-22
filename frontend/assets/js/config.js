/* Where the backend API lives. Change API_BASE when the backend runs somewhere else
   (for example https://api.lilikas.example). You can also override it once in the browser with  ?api=http://host:port
   (it is remembered on this device). */
window.LILIKAS_CONFIG = {
  API_BASE: "http://127.0.0.1:5000",
  // Batangas City centre, used until the person picks a place or shares their location.
  DEFAULT_LOCATION: { lat: 13.7565, lon: 121.0583, label: "Batangas City", source: "default" },
  EMERGENCY_NUMBER: "911",
};
