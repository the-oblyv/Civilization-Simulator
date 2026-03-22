import { MapManager } from './MapManager.js';
import { SimEngine } from './SimEngine.js';
import { UIManager } from './UIManager.js';
import { AudioManager } from './AudioManager.js';

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        
        // Settings
        this.gridSize = 4; // Base size of each tile in pixels
        
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Camera
        this.zoom = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;

        this.audio = new AudioManager();
        this.map = new MapManager();
        this.sim = new SimEngine(this.map, this.audio);
        this.ui = new UIManager(this);

        this.lastTime = 0;
        this.isRunning = false;
        this.mapMode = 'political'; // 'political' or 'alliance'

        this.init();
        this.setupCameraControls();
    }

    setupCameraControls() {
        let isDragging = false;
        let lastX, lastY;

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const mouseX = e.clientX;
            const mouseY = e.clientY;

            const worldX = (mouseX - this.offsetX) / this.zoom;
            const worldY = (mouseY - this.offsetY) / this.zoom;

            const zoomSpeed = 0.1;
            const delta = -Math.sign(e.deltaY) * zoomSpeed;
            const newZoom = Math.min(10, Math.max(0.1, this.zoom + this.zoom * delta));
            
            this.zoom = newZoom;
            this.offsetX = mouseX - worldX * this.zoom;
            this.offsetY = mouseY - worldY * this.zoom;
        }, { passive: false });

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1 || e.button === 2 || (e.button === 0 && this.ui.activeTool === 'pan')) {
                isDragging = true;
                lastX = e.clientX;
                lastY = e.clientY;
                if(e.button === 2) e.preventDefault();
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                this.offsetX += e.clientX - lastX;
                this.offsetY += e.clientY - lastY;
                lastX = e.clientX;
                lastY = e.clientY;
            }
        });

        window.addEventListener('mouseup', () => isDragging = false);
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());

        // Mobile Pinch & Pan
        let lastTouchDist = 0;
        let lastTouchX, lastTouchY;
        
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                lastTouchX = e.touches[0].clientX;
                lastTouchY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                lastTouchDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && this.ui.activeTool === 'pan') {
                const dx = e.touches[0].clientX - lastTouchX;
                const dy = e.touches[0].clientY - lastTouchY;
                this.offsetX += dx;
                this.offsetY += dy;
                lastTouchX = e.touches[0].clientX;
                lastTouchY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                
                const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                const worldX = (centerX - this.offsetX) / this.zoom;
                const worldY = (centerY - this.offsetY) / this.zoom;

                const zoomFactor = dist / lastTouchDist;
                this.zoom = Math.min(10, Math.max(0.1, this.zoom * zoomFactor));
                this.offsetX = centerX - worldX * this.zoom;
                this.offsetY = centerY - worldY * this.zoom;
                lastTouchDist = dist;
            }
        }, { passive: false });
    }

    init() {
        window.addEventListener('resize', () => this.onResize());
        this.loop(0);
    }

    onResize() {
        // We don't want to re-init map on resize as it clears progress
        // Instead, we just adjust canvas scale or leave it as is for simplicity
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    togglePlay() {
        this.isRunning = !this.isRunning;
        return this.isRunning;
    }

    loop(timestamp) {
        const dt = timestamp - this.lastTime;
        this.lastTime = timestamp;

        if (this.isRunning) {
            this.sim.update(dt);
        }

        this.render();
        requestAnimationFrame((t) => this.loop(t));
    }

    render() {
        const { ctx, map, gridSize, zoom, offsetX, offsetY } = this;
        
        // Clear background (Water)
        ctx.fillStyle = '#a2d2ff';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(zoom, zoom);

        // Render distance: Only render tiles within the screen viewport
        const startX = Math.floor((-offsetX) / (gridSize * zoom));
        const endX = Math.ceil((this.canvas.width - offsetX) / (gridSize * zoom));
        const startY = Math.floor((-offsetY) / (gridSize * zoom));
        const endY = Math.ceil((this.canvas.height - offsetY) / (gridSize * zoom));

        // Iterate through visible bounds
        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                const cell = map.getTile(x, y);
                if (!cell || cell.type === 'water') continue;

                if (cell.countryId !== null) {
                    const country = this.sim.countries.get(cell.countryId);
                    if (country) {
                        if (this.mapMode === 'alliance') {
                            const allianceColor = this.sim.getAllianceColor(country.id);
                            ctx.fillStyle = allianceColor || country.color;
                        } else {
                            ctx.fillStyle = country.color;
                        }
                        ctx.fillRect(x * gridSize, y * gridSize, gridSize, gridSize);
                    }

                    // Optimized border drawing
                    const right = map.getTile(x + 1, y);
                    const bottom = map.getTile(x, y + 1);
                    if ((right && right.countryId !== cell.countryId) || (bottom && bottom.countryId !== cell.countryId)) {
                        ctx.fillStyle = 'rgba(0,0,0,0.25)';
                        if (right && right.countryId !== cell.countryId) {
                            ctx.fillRect((x + 1) * gridSize - 1, y * gridSize, 1, gridSize);
                        }
                        if (bottom && bottom.countryId !== cell.countryId) {
                            ctx.fillRect(x * gridSize, (y + 1) * gridSize - 1, gridSize, 1);
                        }
                    }
                } else {
                    ctx.fillStyle = '#ecf0f1';
                    ctx.fillRect(x * gridSize, y * gridSize, gridSize, gridSize);
                }
            }
        }

        // Render Capitals / Names
        this.sim.countries.forEach(country => {
            if (country.isDead) return;
            
            const cap = country.capital;
            const tx = cap.x * gridSize;
            const ty = cap.y * gridSize;

            // Simple visibility check for names
            if (cap.x < startX - 20 || cap.x > endX + 20 || cap.y < startY - 20 || cap.y > endY + 20) return;

            const areaWidth = Math.sqrt(country.territories.size) * gridSize;
            const fontSize = Math.min(40, Math.max(10, areaWidth * 0.25)); 
            
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.shadowBlur = 3;
            ctx.shadowColor = 'rgba(255,255,255,0.8)';
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillText(country.name, tx, ty);
            
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.fillText(country.name, tx, ty);

            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(tx, ty, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();

            if (this.ui.selectedCountryIds.has(country.id)) {
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2;
                const size = 12;
                ctx.beginPath();
                ctx.moveTo(tx - size, ty - size); ctx.lineTo(tx - size/2, ty - size);
                ctx.moveTo(tx - size, ty - size); ctx.lineTo(tx - size, ty - size/2);
                ctx.moveTo(tx + size, ty - size); ctx.lineTo(tx + size/2, ty - size);
                ctx.moveTo(tx + size, ty - size); ctx.lineTo(tx + size, ty - size/2);
                ctx.moveTo(tx - size, ty + size); ctx.lineTo(tx - size/2, ty + size);
                ctx.moveTo(tx - size, ty + size); ctx.lineTo(tx - size, ty + size/2);
                ctx.moveTo(tx + size, ty + size); ctx.lineTo(tx + size/2, ty + size);
                ctx.moveTo(tx + size, ty + size); ctx.lineTo(tx + size, ty + size/2);
                ctx.stroke();
            }
        });

        ctx.restore();
    }
}

// Start game
window.addEventListener('load', () => {
    window.game = new Game();
});
