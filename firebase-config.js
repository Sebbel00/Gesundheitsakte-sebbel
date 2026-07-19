// Firebase-Projekt-Konfiguration
// Hinweis: Diese Werte sind nicht geheim (bei Firebase-Web-Apps üblich).
// Der eigentliche Schutz läuft über Authentication + Firestore Security Rules.
export const firebaseConfig = {
  apiKey: "AIzaSyDWhiXfQqVpnP0n7CjE-eJ_8ho5vEoyWpg",
  authDomain: "gesundheitsakte-sebbel.firebaseapp.com",
  projectId: "gesundheitsakte-sebbel",
  storageBucket: "gesundheitsakte-sebbel.firebasestorage.app",
  messagingSenderId: "893820385152",
  appId: "1:893820385152:web:3b200f764e53f60db33365"
};

// Domain, die für "Pseudo-E-Mails" verwendet wird, damit Nutzer sich nur
// mit einem einfachen Benutzernamen + Passwort anmelden müssen.
export const LOGIN_DOMAIN = "gesundheitsakte-sebbel.local";
