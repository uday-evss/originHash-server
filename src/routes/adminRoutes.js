const express = require('express');
const { protect, superAdminOnly } = require('../middleware/auth');
const {
  listAdmins,
  createAdmin,
  updateAdmin,
  promoteUser,
  demoteAdmin,
} = require('../controllers/adminController');

const router = express.Router();

router.use(protect, superAdminOnly);

router.get('/', listAdmins);
router.post('/', createAdmin);
router.put('/:id', updateAdmin);
router.patch('/:id/promote', promoteUser);
router.patch('/:id/demote', demoteAdmin);

module.exports = router;
