import { Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { DevPanel } from './components/DevPanel';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { OfferBanners } from './components/OfferBanner';
import { Toast } from './components/Toast';
import { useRegistration } from './state/RegistrationProvider';
import { Browse } from './screens/Browse';
import { Checkout } from './screens/Checkout';
import { Confirmation } from './screens/Confirmation';
import { MyRegistrations } from './screens/MyRegistrations';
import { ProgramDetail } from './screens/ProgramDetail';
import styles from './App.module.css';

export function App() {
  const { model, loadError } = useRegistration();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={styles.shell}>
      <Header />
      <Toast />
      <OfferBanners />
      <main className={styles.main}>
        {!model ? (
          <div className="page muted" role="status">{loadError ? `Can't reach registration right now. ${loadError}` : 'Loading programs…'}</div>
        ) : (
          <Routes>
            <Route path="/" element={<Browse model={model} />} />
            <Route path="/programs/:programId" element={<ProgramDetail model={model} />} />
            <Route path="/checkout" element={<Checkout model={model} />} />
            <Route path="/checkout/done" element={<Confirmation model={model} />} />
            <Route path="/account" element={<MyRegistrations model={model} />} />
            <Route path="*" element={<div className="page"><h1>Page not found</h1></div>} />
          </Routes>
        )}
      </main>
      <Footer />
      <DevPanel />
    </div>
  );
}
