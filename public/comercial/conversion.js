// Commercial presentation only: auth and payment handlers remain in app.js.
const bar = document.querySelector('.mobile-offer');
const hero = document.querySelector('.hero');
const modal = document.querySelector('#auth-modal');
function updateOffer() {
 if (!bar || !hero) return;
 bar.hidden = !matchMedia('(max-width:760px)').matches
   || hero.getBoundingClientRect().bottom > 0
   || Boolean(modal && !modal.hidden);
}
addEventListener('scroll', updateOffer, {passive:true});
addEventListener('resize', updateOffer);
if (modal) new MutationObserver(updateOffer).observe(modal, {attributes:true,attributeFilter:['hidden']});
updateOffer();
// Anonymous interaction hooks for an analytics integration; never send form values.
function emit(name, details) {
 const event = {event:name, ...details};
 window.dispatchEvent(new CustomEvent('commercial:conversion', {detail:event}));
 if (Array.isArray(window.dataLayer)) window.dataLayer.push(event);
}
document.addEventListener('click', e => {
 const button = e.target.closest('[data-open="signup"]');
 if (!button) return;
 emit('commercial_cta_click', {plan:button.dataset.plan || 'freemium',placement:button.closest('section')?.id || (button.closest('.mobile-offer') ? 'mobile_offer' : 'navigation')});
});
document.querySelector('#signup-form')?.addEventListener('submit', () => {
 emit('commercial_signup_submit', {plan:document.querySelector('#plan-intent')?.value || 'freemium'});
});
