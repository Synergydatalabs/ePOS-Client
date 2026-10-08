// Mobile menu
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
if (navToggle) {
  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
}

// Monthly / annual pricing toggle
const billingBtns = document.querySelectorAll('[data-billing]');
if (billingBtns.length) {
  const setBilling = (mode) => {
    billingBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.billing === mode)));
    document.querySelectorAll('[data-m]').forEach((el) => {
      el.textContent = '$' + (mode === 'year' ? el.dataset.y : el.dataset.m);
    });
    document.querySelectorAll('.billed').forEach((el) => {
      el.textContent = mode === 'year' ? el.dataset.yearNote : el.dataset.monthNote;
    });
  };
  billingBtns.forEach((b) => b.addEventListener('click', () => setBilling(b.dataset.billing)));
  setBilling('month');
}

// Hero board: one deal moves from "Roasting" to "Brewed" once, and the won total updates.
const board = document.querySelector('.board');
if (board) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const deal = board.querySelector('[data-move]');
  const target = board.querySelector('.stage.won .deals');
  const totalEl = board.querySelector('[data-total]');
  const countFrom = board.querySelector('[data-count-from]');
  const countTo = board.querySelector('[data-count-to]');
  const move = () => {
    if (!deal || !target) return;
    const add = Number(deal.dataset.value);
    const start = Number(totalEl.dataset.total);
    target.prepend(deal);
    deal.classList.add('moving');
    countFrom.textContent = Number(countFrom.textContent) - 1;
    countTo.textContent = Number(countTo.textContent) + 1;
    const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
    if (reduce) { totalEl.textContent = fmt(start + add); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      totalEl.textContent = fmt(start + add * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  setTimeout(move, reduce ? 0 : 1800);
}

// Contact form: no server needed — opens the visitor's email app with the message filled in.
const form = document.querySelector('#contact-form');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const subject = `[${d.get('topic')}] ${d.get('company') || d.get('name')}`;
    const body =
      `Name: ${d.get('name')}\nCompany: ${d.get('company')}\nEmail: ${d.get('email')}\nTeam size: ${d.get('size')}\n\n${d.get('message')}`;
    window.location.href =
      `mailto:${form.dataset.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    form.querySelector('.form-msg').textContent = 'Your email app should open with the message ready to send.';
  });
}

document.querySelectorAll('.year').forEach((el) => (el.textContent = new Date().getFullYear()));

// Pre-fill the contact form from links like contact.html?topic=trial&plan=Growth
const topicSel = document.querySelector('#topic');
if (topicSel) {
  const q = new URLSearchParams(location.search);
  const map = { trial: 'Free trial', sales: 'Sales', support: 'Support', billing: 'Billing' };
  if (map[q.get('topic')]) topicSel.value = map[q.get('topic')];
  const plan = q.get('plan');
  if (plan) document.querySelector('#message').value = `I'd like to start a free trial of the ${plan} plan.`;
}
