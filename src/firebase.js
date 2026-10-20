import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBalPurOi8jMB5atVs6VK9n0P4b2KPFd4E",
  authDomain: "dsa-tracker-santhosh.firebaseapp.com",
  projectId: "dsa-tracker-santhosh",
  storageBucket: "dsa-tracker-santhosh.firebasestorage.app",
  messagingSenderId: "872534891200",
  appId: "1:872534891200:web:5f2169c20d69ba03e8ab25",
  measurementId: "G-KX422M8X1K"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const analyticsReady = isSupported()
  .then((supported) => supported ? getAnalytics(app) : null)
  .catch((error) => {
    console.warn("Firebase Analytics could not be initialized.", error);
    return null;
  });
