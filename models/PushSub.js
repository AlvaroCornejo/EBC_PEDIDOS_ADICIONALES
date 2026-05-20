const mongoose = require('mongoose');
const pushSubSchema = new mongoose.Schema({
  userId:       { type: String, required: true },
  role:         { type: String },
  operations:   [String],
  subscription: { type: mongoose.Schema.Types.Mixed, required: true }
});
pushSubSchema.index({ userId: 1 });
pushSubSchema.index({ 'subscription.endpoint': 1 }, { unique: true });
module.exports = mongoose.model('PushSub', pushSubSchema);
