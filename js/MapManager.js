export class MapManager {
    constructor() {
        this.tiles = new Map(); // Key: "x,y", Value: {type, countryId, strength}
    }

    reset() {
        this.tiles.clear();
    }

    setTile(x, y, type) {
        const key = `${x},${y}`;
        if (type === 'water') {
            this.tiles.delete(key);
            return;
        }
        
        let tile = this.tiles.get(key);
        if (!tile) {
            tile = { type: 'land', countryId: null, strength: 0 };
            this.tiles.set(key, tile);
        }
        tile.type = type;
        if (type === 'water') {
            tile.countryId = null;
        }
    }

    getTile(x, y) {
        return this.tiles.get(`${x},${y}`) || null;
    }

    getNeighbors(x, y) {
        const neighbors = [];
        const coords = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of coords) {
            const tile = this.getTile(nx, ny);
            // In an infinite world, neighbors can exist even if not in Map (water)
            // But for simulation, we mostly care about land
            neighbors.push({ x: nx, y: ny, tile: tile || { type: 'water', countryId: null } });
        }
        return neighbors;
    }
    
    isLand(x, y) {
        const tile = this.getTile(x, y);
        return tile && tile.type === 'land';
    }
}
