exports = module.exports = TestParticipant;

function TestParticipant(TestSessionModel) {
	this.sessions = [this.HasMany(TestSessionModel)];
}
