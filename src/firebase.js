import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA8KfJuHPn_HmnUCZNQiCTj6596z2n84cc",
  authDomain: "baixa-estoque-22c87.firebaseapp.com",
  projectId: "baixa-estoque-22c87",
  storageBucket: "baixa-estoque-22c87.firebasestorage.app",
  messagingSenderId: "440120597097",
  appId: "1:440120597097:web:2eca6c8c13d917959c60f8",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

const DOMINIO_PERMITIDO = "smartgr.com.br";
export const ADMIN_MASTER_EMAIL = "jacke@smartgr.com.br";
export const PAINEL_ALLOWLIST = ["nayra@smartgr.com.br", ADMIN_MASTER_EMAIL];

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ hd: DOMINIO_PERMITIDO });

export async function loginComGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const email = result.user.email || "";

  if (!email.endsWith(`@${DOMINIO_PERMITIDO}`)) {
    await signOut(auth);
    throw new Error(
      `Acesso permitido somente para e-mails @${DOMINIO_PERMITIDO}.`
    );
  }

  return result.user;
}

export function logout() {
  return signOut(auth);
}

export function observarAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function isAdminMaster(user) {
  return !!user && user.email === ADMIN_MASTER_EMAIL;
}

export function podeAcessarPainel(user) {
  return !!user && PAINEL_ALLOWLIST.includes(user.email);
}
