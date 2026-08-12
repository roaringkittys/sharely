function requireAdmin(req, res, next) {
  if (req.session?.userId) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.redirect('/login');
}

function requireMember(req, res, next) {
  if (req.session?.memberId) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Please log in' });
  }

  return res.redirect('/membership/login');
}

module.exports = {
  requireAdmin,
  requireMember
};