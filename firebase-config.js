// Firebase Configuration and Analytics Setup
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD2eHFuplImxBCijd3MWlKyCwXUZHLmhhE",
  authDomain: "taxi-heringsdorf.firebaseapp.com",
  databaseURL: "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "taxi-heringsdorf",
  storageBucket: "taxi-heringsdorf.firebasestorage.app",
  messagingSenderId: "886448081276",
  appId: "1:886448081276:web:1b54875801c5d89f8efcf9",
  measurementId: "G-K8ZG238WW6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

console.log('🔥 Firebase initialized successfully');

// Analytics Helper Functions
export function trackPageView(pageName) {
  logEvent(analytics, 'page_view', {
    page_name: pageName,
    page_location: window.location.href,
    page_title: document.title
  });
  console.log('📊 Page view tracked:', pageName);
}

export function trackRideBooked(rideData) {
  logEvent(analytics, 'ride_booked', {
    pickup: rideData.pickup,
    destination: rideData.destination,
    passengers: rideData.passengers,
    price: rideData.price,
    distance: rideData.distance,
    value: parseFloat(rideData.price)
  });
  console.log('📊 Ride booked tracked:', rideData.id);
}

export function trackRideAccepted(rideId, vehicle) {
  logEvent(analytics, 'ride_accepted', {
    ride_id: rideId,
    vehicle: vehicle
  });
  console.log('📊 Ride accepted tracked:', rideId);
}

export function trackRideCompleted(rideData) {
  logEvent(analytics, 'ride_completed', {
    ride_id: rideData.id,
    vehicle: rideData.vehicle,
    price: rideData.price,
    value: parseFloat(rideData.price)
  });
  console.log('📊 Ride completed tracked:', rideData.id);
}

export function trackPriceCalculation(pickup, destination, distance, price) {
  logEvent(analytics, 'price_calculated', {
    pickup: pickup,
    destination: destination,
    distance: distance,
    price: price,
    value: parseFloat(price)
  });
  console.log('📊 Price calculation tracked');
}

export function trackVehicleSelected(vehicle) {
  logEvent(analytics, 'vehicle_selected', {
    vehicle: vehicle
  });
  console.log('📊 Vehicle selected tracked:', vehicle);
}

export function trackError(errorMessage, errorContext) {
  logEvent(analytics, 'error', {
    error_message: errorMessage,
    error_context: errorContext
  });
  console.log('📊 Error tracked:', errorMessage);
}

// Export analytics instance for custom events
export { analytics };
