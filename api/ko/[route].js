// Single entry point for /api/ko/* (keeps the project under the function cap).
const routes = {
  login: require('./_lib/routes/login'),
  logout: require('./_lib/routes/logout'),
  session: require('./_lib/routes/session'),
  deals: require('./_lib/routes/deals'),
  notes: require('./_lib/routes/notes'),
  application: require('./_lib/routes/application'),
};

module.exports = async function handler(req, res) {
  const name = String((req.query && req.query.route) || '');
  const route = Object.prototype.hasOwnProperty.call(routes, name) ? routes[name] : null;
  if (!route) return res.status(404).json({ ok: false, error: 'Not found.' });
  return route(req, res);
};
