export class AudioManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }

    play(type) {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        const oscillator = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        oscillator.connect(gain);
        gain.connect(this.ctx.destination);

        if (type === 'war_start') {
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(150, this.ctx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
            oscillator.start();
            oscillator.stop(this.ctx.currentTime + 0.2);
        } else if (type === 'conquest') {
            oscillator.type = 'sawtooth';
            oscillator.frequency.setValueAtTime(100, this.ctx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
            oscillator.start();
            oscillator.stop(this.ctx.currentTime + 0.3);
        }
    }
}
