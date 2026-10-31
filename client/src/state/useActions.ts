import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { kidName, myHolds, sectionName } from '../domain/model';
import { useRegistration } from './RegistrationProvider';

/** Every booking action, with the confirmation copy the design shows for it. */
export function useActions() {
  const { model, run, showToast, setLastOrder } = useRegistration();
  const navigate = useNavigate();
  const name = (sectionId: string) => (model ? sectionName(model, sectionId) : '');
  const kid = (id: string | null) => (model ? kidName(model, id) : 'Your child');

  return {
    async addToCart(sectionId: string, childId: string) {
      const res = await run(() => api.addToCart(sectionId, childId));
      if (!res) return false;
      showToast(
        res.lastSpot
          ? { text: `You have the last spot in ${name(sectionId)}. Other families now see it as in someone’s cart. Check out within 5 minutes to keep it.`, tone: 'good', toCheckout: true }
          : { text: `Added ${kid(childId)} to ${name(sectionId)}. The spot is held for 5 minutes.`, tone: 'good', toCheckout: true },
      );
      return true;
    },

    async removeFromCart(holdId: string, sectionId: string) {
      if ((await run(() => api.removeFromCart(holdId))) === null) return;
      showToast({ text: `Removed from your cart. The spot in ${name(sectionId)} was released.`, tone: 'info' });
    },

    async joinWaitlist(sectionId: string, childId: string, autoRegister: boolean) {
      const res = await run(() => api.joinWaitlist(sectionId, childId, autoRegister));
      if (!res) return false;
      showToast({
        text: `${kid(childId)} is #${res.entry.position} on the waitlist for ${name(sectionId)}. ` +
          (autoRegister
            ? `If a spot opens, we’ll register ${kid(childId)} and charge your saved card automatically.`
            : 'If a spot opens, we’ll text and email you, and you’ll have 2 hours to accept it.'),
        tone: 'info',
      });
      return true;
    },

    async setWaitlistMode(entryId: string, sectionId: string, childId: string, autoRegister: boolean) {
      if ((await run(() => api.setWaitlistMode(entryId, autoRegister))) === null) return;
      showToast({
        text: autoRegister
          ? `${kid(childId)} will be registered and charged automatically if a spot opens in ${name(sectionId)}.`
          : `We’ll notify you first if a spot opens in ${name(sectionId)}. You’ll have 2 hours to accept.`,
        tone: 'info',
      });
    },

    async setReminder(programId: string, on: boolean) {
      if ((await run(() => api.setReminder(programId, on))) === null) return;
      const program = model?.program(programId)?.name ?? 'this program';
      showToast({
        text: on ? `We’ll text and email you when registration for ${program} opens.` : `Reminder turned off for ${program}.`,
        tone: 'info',
      });
    },

    async leaveWaitlist(entryId: string, sectionId: string, childId: string) {
      if ((await run(() => api.leaveWaitlist(entryId))) === null) return;
      showToast({ text: `${kid(childId)} left the waitlist for ${name(sectionId)}.`, tone: 'info' });
    },

    async acceptOffer(holdId: string, childId: string | null) {
      const res = await run(() => api.acceptOffer(holdId));
      if (!res) return;
      navigate('/checkout');
      showToast({ text: `Spot accepted. Pay now to confirm ${kid(childId)}’s registration.`, tone: 'good' });
    },

    async declineOffer(holdId: string, sectionId: string) {
      if ((await run(() => api.declineOffer(holdId))) === null) return;
      showToast({ text: `You declined the spot in ${name(sectionId)}. It goes to the next family in line.`, tone: 'info' });
    },

    async withdraw(registrationId: string, sectionId: string, childId: string) {
      if ((await run(() => api.withdraw(registrationId))) === null) return;
      showToast({
        text: `${kid(childId)} was withdrawn from ${name(sectionId)}. Any refund follows the cancellation policy, which is still being decided.`,
        tone: 'info',
      });
    },

    async checkout() {
      if (!model) return;
      const holdIds = myHolds(model, 'cart').map((h) => h.id);
      if (!holdIds.length) return;
      const order = await run(() => api.checkout(holdIds));
      if (!order) return;
      setLastOrder(order);
      showToast(null);
      navigate('/checkout/done');
    },
  };
}
