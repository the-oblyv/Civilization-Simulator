export class SimEngine {
    constructor(map, audio) {
        this.map = map;
        this.audio = audio;
        this.countries = new Map();
        this.truces = new Map(); // Key: "lowID-highID", Value: expiryYear
        this.year = 1000;
        this.tickCounter = 0;
        this.speed = 5;
        this.nextId = 1;
        this.revoltsEnabled = false;
        this.civilWarsEnabled = false;
        this.alliancesEnabled = true;
    }

    addCountry(name, color, x, y, isTribe = false) {
        const id = this.nextId++;
        const country = {
            id,
            name,
            color,
            capital: { x, y },
            territories: new Set(),
            isDead: false,
            isTribe: isTribe,
            warExhaustion: 0,
            strength: isTribe ? (0.2 + Math.random() * 0.3) : (0.6 + Math.random() * 1.2),
            gold: isTribe ? 10 : 50,
            relations: new Map() // ID -> 'war' | 'ally'
        };
        
        const key = `${x},${y}`;
        country.territories.add(key);
        this.map.setTile(x, y, 'land');
        this.map.getTile(x, y).countryId = id;
        
        this.countries.set(id, country);
        this.audio.play('war_start');
        return country;
    }

    update(dt) {
        this.tickCounter++;
        
        // Sim speed controls frequency of updates
        const threshold = Math.max(1, 11 - Math.floor(this.speed / 5));
        if (this.tickCounter % threshold !== 0) return;

        this.year += 1;
        
        // AI Diplomacy check
        if (this.year % 5 === 0) {
            this.handleAIDiplomacy();
        }

        // Revolt check
        if (this.revoltsEnabled && this.year % 20 === 0) {
            this.handleRevolts();
        }

        // Civil War check
        if (this.civilWarsEnabled && this.year % 50 === 0) {
            this.handleCivilWars();
        }

        // Periodic Border Gore Cleanup
        if (this.year % 5 === 0) {
            this.cleanupBorderGore();
        }

        // Process Focus Trees
        this.handleFocusTrees();

        // Intensity scales aggressively with user speed setting
        let intensity = Math.ceil(this.speed / 3);

        // Cache territory arrays once per tick for performance
        const activeCountries = [];
        this.countries.forEach(c => {
            if (!c.isDead) {
                const relations = Array.from(c.relations.values());
                const isAtWar = relations.includes('war') || relations.includes('death_war');
                
                // Update war exhaustion
                if (isAtWar) {
                    c.warExhaustion = Math.min(100, c.warExhaustion + 0.15);
                } else {
                    c.warExhaustion = Math.max(0, c.warExhaustion - 0.4);
                }

                activeCountries.push({
                    country: c,
                    territoryList: Array.from(c.territories),
                    isAtWar: isAtWar
                });

                // Strength growth over time (Age bonus)
                const growthRate = c.isTribe ? 0.0002 : 0.0008;
                c.strength += growthRate;
            }
        });

        for (let i = 0; i < intensity; i++) {
            activeCountries.forEach(data => {
                const country = data.country;
                
                // Run injected AI code
                if (country.customUpdate) {
                    try {
                        country.customUpdate(this, country);
                    } catch (e) {
                        console.error(`Script error for ${country.name}:`, e);
                        country.customUpdate = null; // Remove buggy scripts
                    }
                }

                this.simulateCountry(country, data.territoryList, data.isAtWar);
            });
        }
        
        // Cleanup dead countries
        this.countries.forEach(country => {
            if (!country.isDead && country.territories.size === 0) {
                this.handleCountryDeath(country);
            }
        });
    }

    handleCountryDeath(country, victor = null) {
        if (country.isDead) return;
        country.isDead = true;

        // Remove all diplomatic relations other nations had with this country
        this.countries.forEach(other => {
            if (other.relations.has(country.id)) {
                other.relations.delete(country.id);
            }
        });

        // Clear any active truces involving this country
        for (const key of Array.from(this.truces.keys())) {
            const [idA, idB] = key.split('-').map(Number);
            if (idA === country.id || idB === country.id) {
                this.truces.delete(key);
            }
        }

        // Exhaustive Map Search in sparse map:
        for (const [key, tile] of this.map.tiles.entries()) {
            if (tile.countryId === country.id) {
                if (victor && !victor.isDead) {
                    tile.countryId = victor.id;
                    victor.territories.add(key);
                } else {
                    tile.countryId = null;
                }
            }
        }
        
        country.territories.clear();

        // Completely remove from the simulation's master records
        this.countries.delete(country.id);
        
        this.audio.play('conquest');
        
        // Immediate multiple cleanup passes to smooth the transition for the victor
        for (let i = 0; i < 3; i++) this.cleanupBorderGore();
    }

    getAllianceGroup(countryId) {
        const group = new Set([countryId]);
        const queue = [countryId];
        while (queue.length > 0) {
            const currentId = queue.shift();
            const current = this.countries.get(currentId);
            if (!current) continue;
            current.relations.forEach((rel, otherId) => {
                if ((rel === 'ally' || rel === 'permanent_ally') && !group.has(otherId)) {
                    group.add(otherId);
                    queue.push(otherId);
                }
            });
        }
        return group;
    }

    getAllianceColor(countryId) {
        const group = this.getAllianceGroup(countryId);
        if (group.size <= 1) return null;
        
        // Use the color of the largest country in the alliance as the bloc color
        let largest = null;
        let maxSize = -1;
        group.forEach(id => {
            const c = this.countries.get(id);
            if (c && c.territories.size > maxSize) {
                maxSize = c.territories.size;
                largest = c;
            }
        });
        return largest ? largest.color : null;
    }

    handleAIDiplomacy() {
        const activeOnes = Array.from(this.countries.values()).filter(c => !c.isDead);
        if (activeOnes.length < 2) return;

        activeOnes.forEach(country => {
            if (Math.random() > 0.85) {
                const targets = activeOnes.filter(c => c.id !== country.id);
                if (targets.length === 0) return;
                
                // Advanced target selection: look for common enemies for alliances
                const enemies = Array.from(country.relations.entries())
                    .filter(([_, rel]) => rel === 'war')
                    .map(([id, _]) => id);

                let randomTarget;
                if (enemies.length > 0 && Math.random() < 0.7) {
                    // Look for someone else who is also at war with one of my enemies
                    const potentialAllies = targets.filter(t => {
                        return enemies.some(enemyId => t.relations.get(enemyId) === 'war');
                    });
                    if (potentialAllies.length > 0) {
                        randomTarget = potentialAllies[Math.floor(Math.random() * potentialAllies.length)];
                    } else {
                        randomTarget = targets[Math.floor(Math.random() * targets.length)];
                    }
                } else {
                    randomTarget = targets[Math.floor(Math.random() * targets.length)];
                }
                
                const currentRel = country.relations.get(randomTarget.id);
                
                if (!currentRel) {
                    if (this.hasTruce(country.id, randomTarget.id)) return;

                    // Logic: If target is fighting a common enemy, 90% chance to ally
                    const sharedEnemy = enemies.some(eId => randomTarget.relations.get(eId) === 'war');
                    
                    if (sharedEnemy) {
                        if (this.alliancesEnabled) {
                            this.setRelation(country.id, randomTarget.id, 'ally');
                            console.log(`${country.name} forms a defensive pact with ${randomTarget.name} against common foes!`);
                        } else {
                            // If alliances are off, they might just stay neutral or go to war anyway
                            if (Math.random() < 0.4) this.setRelation(country.id, randomTarget.id, 'war');
                        }
                    } else {
                        if (Math.random() < 0.6) {
                            this.setRelation(country.id, randomTarget.id, 'war');
                        } else if (this.alliancesEnabled) {
                            this.setRelation(country.id, randomTarget.id, 'ally');
                        }
                    }
                } else if (currentRel === 'ally' || currentRel === 'permanent_ally') {
                    // Permanent alliances never break
                    if (currentRel === 'permanent_ally') return;

                    // Standard alliances can break apart or turn into sudden betrayal
                    const breakRoll = Math.random();
                    if (breakRoll < 0.05) {
                        // Betrayal: Ally immediately becomes Enemy
                        this.setRelation(country.id, randomTarget.id, 'war');
                        console.log(`BETRAYAL! ${country.name} has turned against their ally ${randomTarget.name}!`);
                    } else if (breakRoll < 0.25) {
                        // Dissolve: Back to neutral
                        this.setRelation(country.id, randomTarget.id, 'neutral');
                        console.log(`The alliance between ${country.name} and ${randomTarget.name} has been dissolved.`);
                    }
                } else if (currentRel === 'war') {
                    // Opportunity for peace treaties based on exhaustion
                    const peaceChance = 0.02 + (country.warExhaustion / 400) + (randomTarget.warExhaustion / 400);
                    if (Math.random() < peaceChance) {
                        this.setRelation(country.id, randomTarget.id, 'neutral');
                        this.addTruce(country.id, randomTarget.id, 30);
                    }
                } else if (currentRel === 'death_war') {
                    // No peace chance in a fight to the death
                    return;
                }
            }
        });
    }

    getTruceKey(idA, idB) {
        return [idA, idB].sort((a, b) => a - b).join('-');
    }

    addTruce(idA, idB, duration) {
        this.truces.set(this.getTruceKey(idA, idB), this.year + duration);
    }

    hasTruce(idA, idB) {
        const key = this.getTruceKey(idA, idB);
        const expiry = this.truces.get(key);
        if (!expiry) return false;
        if (this.year >= expiry) {
            this.truces.delete(key);
            return false;
        }
        return true;
    }

    setRelation(idA, idB, type) {
        const a = this.countries.get(idA);
        const b = this.countries.get(idB);
        if (!a || !b) return;

        if (type === 'ally' && !this.alliancesEnabled) return;

        if (type === 'war' && this.hasTruce(idA, idB)) {
            console.log(`Truce in effect between ${a.name} and ${b.name}`);
            return;
        }

        if (type === 'neutral') {
            a.relations.delete(idB);
            b.relations.delete(idA);
        } else {
            a.relations.set(idB, type);
            b.relations.set(idA, type);
        }
        
        if (type === 'war' || type === 'death_war') this.audio.play('war_start');
    }

    simulateCountry(country, territoryList, isAtWar) {
        if (!territoryList || territoryList.length === 0) return;

        // Increased base samples to make conquering "traces" (unowned land) more active
        // Fight to the death wars get boosted samples to ensure high speed
        const hasDeathWar = Array.from(country.relations.values()).includes('death_war');
        const isDoingFocus = country.focusTree && country.focusTree.some(f => f.status === 'in_progress');
        
        let samples = hasDeathWar ? 50 : (isAtWar ? 30 : 10);
        if (isDoingFocus) samples += 25; // "At all cost" focus priority boost
        
        // Tribes are weaker and expand slower
        if (country.isTribe) {
            samples = Math.ceil(samples / 2.5);
        }

        for (let s = 0; s < samples; s++) {
            const randomIndex = Math.floor(Math.random() * territoryList.length);
            const [tx, ty] = territoryList[randomIndex].split(',').map(Number);
            
            const neighbors = this.map.getNeighbors(tx, ty);

            neighbors.forEach(({x: nx, y: ny, tile}) => {
                if (tile.type === 'water') return;

                const targetId = tile.countryId;
                
                // If tile is unowned OR the owner is non-existent/dead (the "ghost traces")
                if (targetId === null || !this.countries.has(targetId)) {
                    if (targetId !== country.id) {
                        tile.countryId = country.id;
                        country.territories.add(`${nx},${ny}`);
                    }
                } else if (targetId !== country.id) {
                    const target = this.countries.get(targetId);
                    if (!target || target.isDead) return;

                    const relation = country.relations.get(target.id);
                    if (relation === 'ally' || relation === 'permanent_ally') return;

                    const isDeathWar = relation === 'death_war';
                    let winChance = (relation === 'war' || isDeathWar) ? 0.8 : 0.05;
                    
                    // Factor in relative strength and war exhaustion
                    // Fight to the death wars ignore exhaustion penalties to prevent slowing down
                    const attExh = isDeathWar ? 0 : country.warExhaustion;
                    const defExh = isDeathWar ? 0 : target.warExhaustion;

                    const attackerEff = country.strength * (1 - (attExh / 200)); 
                    const defenderEff = target.strength * (1 - (defExh / 120)); 
                    
                    const attackerStrength = attackerEff * (1 + country.territories.size / 5000);
                    const defenderStrength = defenderEff * (1 + target.territories.size / 5000);
                    winChance *= (attackerStrength / defenderStrength);
                    winChance = Math.min(0.98, Math.max(0.01, winChance));
                    
                    if (Math.random() < winChance) {
                        if (nx === target.capital.x && ny === target.capital.y) {
                            this.handlePeaceTreaty(country, target);
                            return;
                        }

                        tile.countryId = country.id;
                        country.territories.add(`${nx},${ny}`);
                        target.territories.delete(`${nx},${ny}`);
                    }
                }
            });
        }
    }

    handlePeaceTreaty(victor, loser) {
        if (loser.isDead) return;

        const relation = victor.relations.get(loser.id);
        const isDeathWar = relation === 'death_war';

        const territoryArray = Array.from(loser.territories);
        
        // Random chance for total annexation (40% base)
        // Smaller nations (under 50 tiles) have a 60% chance of being fully annexed
        const annexationRoll = Math.random();
        const annexationThreshold = territoryArray.length < 50 ? 0.6 : 0.4;

        if (isDeathWar || annexationRoll < annexationThreshold) {
            // Full Annexation: Victor inherits everything via handleCountryDeath's map scan
            this.handleCountryDeath(loser, victor);
            console.log(`${victor.name} has fully annexed ${loser.name}!`);
            return;
        }

        // Logic: Victor takes ~75% of land if total annexation didn't happen
        
        // Sort by distance to the captured capital to take surrounding lands first
        territoryArray.sort((a, b) => {
            const [ax, ay] = a.split(',').map(Number);
            const [bx, by] = b.split(',').map(Number);
            const distA = Math.hypot(ax - loser.capital.x, ay - loser.capital.y);
            const distB = Math.hypot(bx - loser.capital.x, by - loser.capital.y);
            return distA - distB;
        });

        const numToTake = Math.floor(territoryArray.length * 0.75);
        const taken = territoryArray.slice(0, numToTake);
        const remaining = territoryArray.slice(numToTake);

        taken.forEach(key => {
            const [lx, ly] = key.split(',').map(Number);
            const tile = this.map.getTile(lx, ly);
            if (tile) {
                // Victor takes all the treaty land
                tile.countryId = victor.id;
                victor.territories.add(key);
                loser.territories.delete(key);
            }
        });

        if (remaining.length < 5) {
            // Annex the rest if they are too small to survive
            remaining.forEach(key => {
                const [lx, ly] = key.split(',').map(Number);
                const tile = this.map.getTile(lx, ly);
                if (tile) {
                    tile.countryId = victor.id;
                    victor.territories.add(key);
                    loser.territories.delete(key);
                }
            });
            this.handleCountryDeath(loser, victor);
            console.log(`${victor.name} has fully annexed ${loser.name}!`);
        } else {
            // Loser survives, picks new capital
            const newCapKey = remaining[Math.floor(Math.random() * remaining.length)];
            const [nx, ny] = newCapKey.split(',').map(Number);
            loser.capital = { x: nx, y: ny };
            
            // Force peace and add a 50-year truce
            this.setRelation(victor.id, loser.id, 'neutral');
            this.addTruce(victor.id, loser.id, 50);
            console.log(`${victor.name} signed a peace treaty with ${loser.name}. A 50-year truce is in effect.`);
        }
        
        this.audio.play('conquest');
        // Clean up borders immediately after land transfer
        for (let i = 0; i < 3; i++) this.cleanupBorderGore();
    }

    handleRevolts() {
        const activeCountries = Array.from(this.countries.values()).filter(c => !c.isDead && c.territories.size > 150);
        if (activeCountries.length === 0) return;

        activeCountries.forEach(country => {
            // Revolts are now conditional: 
            // 1. Being at war (instability)
            // 2. Being extremely large (overextension)
            const relations = Array.from(country.relations.values());
            const isAtWar = relations.includes('war') || relations.includes('death_war');
            const isOverextended = country.territories.size > 800;
            
            if (!isAtWar && !isOverextended) return;

            // Base chance reduced to 2%, plus scaling for size
            const revoltChance = 0.02 + (country.territories.size / 20000);
            if (Math.random() < revoltChance) {
                this.triggerRevolt(country);
            }
        });
    }

    triggerRevolt(parent) {
        const territoryArray = Array.from(parent.territories);
        if (territoryArray.length < 50) return;

        // Pick a random seed point for the revolt
        const seedIndex = Math.floor(Math.random() * territoryArray.length);
        const seedKey = territoryArray[seedIndex];
        const [sx, sy] = seedKey.split(',').map(Number);

        // Name for the rebel state
        const rebelName = `${parent.name} Rebels`;
        const rebelColor = this.generateUniqueColor();
        
        // Create the country at the seed point
        const rebel = this.addCountry(rebelName, rebelColor, sx, sy);
        
        // Spread the revolt to nearby tiles
        const revoltSize = Math.floor(territoryArray.length * (0.1 + Math.random() * 0.2));
        const queue = [seedKey];
        const revoltTerritory = new Set([seedKey]);

        let iterations = 0;
        while (queue.length > 0 && revoltTerritory.size < revoltSize && iterations < 1000) {
            iterations++;
            const current = queue.shift();
            const [cx, cy] = current.split(',').map(Number);
            const neighbors = this.map.getNeighbors(cx, cy);

            neighbors.forEach(n => {
                const nKey = `${n.x},${n.y}`;
                if (parent.territories.has(nKey) && !revoltTerritory.has(nKey)) {
                    revoltTerritory.add(nKey);
                    queue.push(nKey);
                }
            });
        }

        // Transfer territory
        revoltTerritory.forEach(key => {
            const [rx, ry] = key.split(',').map(Number);
            const tile = this.map.getTile(rx, ry);
            if (tile && tile.countryId === parent.id) {
                tile.countryId = rebel.id;
                rebel.territories.add(key);
                parent.territories.delete(key);
            }
        });

        // Ensure parent and rebel are at war
        this.setRelation(parent.id, rebel.id, 'war');
        console.log(`REVOLT! ${rebelName} has risen up against ${parent.name}!`);
        
        // Cleanup border gore after transfer
        this.cleanupBorderGore();
    }

    handleCivilWars() {
        const candidates = Array.from(this.countries.values()).filter(c => !c.isDead && c.territories.size > 200);
        if (candidates.length === 0) return;

        // Very rare random occurrence per check
        if (Math.random() < 0.15) {
            const country = candidates[Math.floor(Math.random() * candidates.length)];
            this.triggerCivilWar(country);
        }
    }

    triggerCivilWar(parent) {
        const territoryArray = Array.from(parent.territories);
        if (territoryArray.length < 100) return;

        // Pick a point far from the capital to start the "Loyalist" vs "Rebel" split
        // Or just pick a random seed
        const seedIndex = Math.floor(Math.random() * territoryArray.length);
        const seedKey = territoryArray[seedIndex];
        const [sx, sy] = seedKey.split(',').map(Number);

        const templates = [
            `Free ${parent.name}`,
            `Union of ${parent.name}`,
            `State of ${parent.name}`
        ];
        const rebelName = templates[Math.floor(Math.random() * templates.length)];
        const rebelColor = this.generateUniqueColor();
        
        // Ensure parent loses ownership of seed tile before establishing rebel capital
        parent.territories.delete(seedKey);
        const rebel = this.addCountry(rebelName, rebelColor, sx, sy);

        // Asynchronously generate a more creative name using AI
        this.generateAIRebelName(rebel.id, parent.name);
        
        // Civil wars take a large chunk, roughly 30-50%
        const splitSize = Math.floor(territoryArray.length * (0.3 + Math.random() * 0.2));
        const queue = [seedKey];
        const rebelTerritory = new Set([seedKey]);

        let iterations = 0;
        while (queue.length > 0 && rebelTerritory.size < splitSize && iterations < 2000) {
            iterations++;
            const current = queue.shift();
            const [cx, cy] = current.split(',').map(Number);
            const neighbors = this.map.getNeighbors(cx, cy);

            neighbors.forEach(n => {
                const nKey = `${n.x},${n.y}`;
                if (parent.territories.has(nKey) && !rebelTerritory.has(nKey)) {
                    rebelTerritory.add(nKey);
                    queue.push(nKey);
                }
            });
        }

        rebelTerritory.forEach(key => {
            const [rx, ry] = key.split(',').map(Number);
            const tile = this.map.getTile(rx, ry);
            if (tile && (tile.countryId === parent.id || key === seedKey)) {
                tile.countryId = rebel.id;
                rebel.territories.add(key);
                parent.territories.delete(key);
            }
        });

        // Check if parent lost its capital during the split and relocate it if necessary
        const parentCapKey = `${parent.capital.x},${parent.capital.y}`;
        if (!parent.territories.has(parentCapKey)) {
            const remaining = Array.from(parent.territories);
            if (remaining.length > 0) {
                const newCapKey = remaining[Math.floor(Math.random() * remaining.length)];
                const [nx, ny] = newCapKey.split(',').map(Number);
                parent.capital = { x: nx, y: ny };
                console.log(`${parent.name} has relocated its capital after losing it to the civil war!`);
            }
        }

        this.setRelation(parent.id, rebel.id, 'war');
        // Maximize exhaustion to make the war intense and potentially quick
        parent.warExhaustion = 40;
        rebel.warExhaustion = 20;

        console.log(`CIVIL WAR! ${parent.name} has split! The faction ${rebelName} seeks independence!`);
        this.cleanupBorderGore();
    }

    hexToRgb(hex) {
        if (hex.startsWith('rgb')) {
            const parts = hex.match(/\d+/g);
            return { r: parseInt(parts[0]), g: parseInt(parts[1]), b: parseInt(parts[2]) };
        }
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 };
    }

    getColorDistance(hex1, hex2) {
        const c1 = this.hexToRgb(hex1);
        const c2 = this.hexToRgb(hex2);
        return Math.sqrt(
            Math.pow(c1.r - c2.r, 2) +
            Math.pow(c1.g - c2.g, 2) +
            Math.pow(c1.b - c2.b, 2)
        );
    }

    generateUniqueColor() {
        let color;
        let attempts = 0;
        const threshold = 60; // Visual distance threshold

        do {
            color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
            attempts++;
            
            let tooClose = false;
            for (const country of this.countries.values()) {
                if (country.isDead) continue;
                if (this.getColorDistance(color, country.countryColor || country.color) < threshold) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) break;
        } while (attempts < 50);
        
        return color;
    }

    async generateAIRebelName(rebelId, parentName) {
        try {
            const completion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `You are a creative historian in a world simulation. 
                        Generate a unique name for a rebel faction splitting from "${parentName}".
                        Follow one of these formats:
                        - Free [Parent Name]
                        - Union of [Parent Name]
                        - State of [Parent Name]
                        You can refine it slightly (e.g., "The United Free [Parent Name]" or "Democratic Union of [Parent Name]") but keep the core naming convention requested.
                        Respond directly with JSON in this format: {"name": "..."}`
                    },
                    {
                        role: "user",
                        content: `Generate a creative rebel name based on the parent nation: "${parentName}".`
                    }
                ],
                json: true
            });

            const result = JSON.parse(completion.content);
            const rebel = this.countries.get(rebelId);
            if (rebel && !rebel.isDead && result.name) {
                console.log(`AI Renamed ${rebel.name} to ${result.name}`);
                rebel.name = result.name;
            }
        } catch (error) {
            console.error("Failed to generate AI name for rebel faction:", error);
        }
    }

    dissolveAllAlliances() {
        this.countries.forEach(country => {
            country.relations.forEach((rel, otherId) => {
                if (rel === 'ally') {
                    country.relations.delete(otherId);
                    const other = this.countries.get(otherId);
                    if (other) other.relations.delete(country.id);
                }
            });
        });
        console.log("All global alliances have been dissolved.");
    }

    uniteCountries(absorberId, absorbedId) {
        if (absorberId === absorbedId) return;
        const absorber = this.countries.get(absorberId);
        const absorbed = this.countries.get(absorbedId);
        if (!absorber || !absorbed) return;

        console.log(`${absorber.name} has united with ${absorbed.name}!`);
        this.handleCountryDeath(absorbed, absorber);
        this.cleanupBorderGore();
    }

    handleFocusTrees() {
        this.countries.forEach(country => {
            if (country.isDead || !country.focusTree || country.focusTree.length === 0) return;

            // Check for currently progressing focus
            let activeFocus = country.focusTree.find(f => f.status === 'in_progress');
            
            if (activeFocus) {
                // "At all cost" implementation: Boost performance while a focus is active
                country.strength += 0.001; // Focus-based zeal
                
                activeFocus.progress += 1;
                if (activeFocus.progress >= activeFocus.duration) {
                    this.completeFocus(country, activeFocus);
                }
            } else {
                // Find next available focus
                const nextFocus = country.focusTree.find(f => f.status === 'locked');
                if (nextFocus) {
                    nextFocus.status = 'in_progress';
                    nextFocus.progress = 0;
                    console.log(`${country.name} started focus: ${nextFocus.name}`);
                }
            }
        });
    }

    completeFocus(country, focus) {
        focus.status = 'completed';
        console.log(`${country.name} completed focus: ${focus.name}`);

        // Apply Effects
        switch (focus.effect) {
            case 'strength_boost':
                country.strength *= 1.3;
                break;
            case 'territory_gain':
                this.expandCountryTerritory(country, 100);
                break;
            case 'declare_war':
                this.forceRandomConflict(country, 'war');
                break;
            case 'death_war':
                this.forceRandomConflict(country, 'death_war');
                break;
            case 'revolt_neighbor':
                this.instigateNeighborRevolt(country);
                break;
            case 'gold_gain':
                country.strength += 0.5; // Simulate economic boost
                break;
            case 'custom':
                this.executeCustomFocus(country, focus);
                break;
        }
        
        this.audio.play('war_start'); // Use existing SFX for completion feedback
    }

    async executeCustomFocus(country, focus) {
        if (!focus.description || focus.description.trim() === '') return;

        try {
            console.log(`Evolving nation code for ${country.name} based on focus: "${focus.description}"`);
            
            const neighbors = Array.from(this.countries.values())
                .filter(c => !c.isDead && c.id !== country.id)
                .map(c => ({ id: c.id, name: c.name }));

            const completion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `You are an expert simulation programmer. You must generate JavaScript logic that will be injected into a nation's 'customUpdate' hook.
                        This code will run every simulation tick.
                        
                        Current Nation context:
                        - Name: ${country.name}
                        - ID: ${country.id}
                        - Neighbors: ${JSON.stringify(neighbors)}
                        
                        Available Objects in scope:
                        - 'sim': The SimEngine instance. Use methods: 
                            sim.setRelation(aId, bId, type), 
                            sim.expandCountryTerritory(country, amount), 
                            sim.triggerRevolt(parent), 
                            sim.addTruce(idA, idB, dur)
                        - 'country': The current country object. Properties: 
                            country.strength, country.warExhaustion, country.territories (Set), 
                            country.relations (Map), country.isTribe
                        
                        Rules:
                        1. Provide a 'script' property which is a string of JS. This JS will be used as a function body: function(sim, country) { ... }.
                        2. Do not use external libraries.
                        3. You can modify 'country.strength' or call 'sim' methods.
                        4. Provide a 'oneTimeEffect' property for immediate changes (annexation, massive strength boost).
                        5. Provide a 'description' of what this new code does.

                        Respond directly with JSON:
                        {
                            "script": "string", // JS function body
                            "oneTimeEffect": {
                                "strengthBoost": number,
                                "territoryGain": number,
                                "forceWar": number|null,
                                "forceAlly": number|null
                            },
                            "description": "string"
                        }`
                    },
                    {
                        role: "user",
                        content: `Implement behavior for focus: "${focus.name}". Intent: "${focus.description}"`
                    }
                ],
                json: true
            });

            const result = JSON.parse(completion.content);
            console.log(`[AI Logic Update] ${country.name}: ${result.description}`);

            // Apply One-Time Effects
            if (result.oneTimeEffect) {
                const eff = result.oneTimeEffect;
                if (eff.strengthBoost) country.strength *= eff.strengthBoost;
                if (eff.territoryGain) this.expandCountryTerritory(country, eff.territoryGain);
                if (eff.forceWar) this.setRelation(country.id, eff.forceWar, 'war');
                if (eff.forceAlly) this.setRelation(country.id, eff.forceAlly, 'ally');
            }

            // Inject Custom Logic
            if (result.script) {
                try {
                    // We append existing logic if any, or replace based on player intent? 
                    // Let's replace to keep it fresh per focus.
                    country.customUpdate = new Function('sim', 'country', result.script);
                } catch (e) {
                    console.error("Failed to compile nation script:", e);
                }
            }

        } catch (error) {
            console.error("Failed to evolve nation code:", error);
        }
    }

    expandCountryTerritory(country, amount) {
        const list = Array.from(country.territories);
        for (let i = 0; i < amount; i++) {
            if (list.length === 0) break;
            const seed = list[Math.floor(Math.random() * list.length)];
            const [x, y] = seed.split(',').map(Number);
            const neighbors = this.map.getNeighbors(x, y);
            neighbors.forEach(n => {
                if (n.tile.type === 'land' && n.tile.countryId !== country.id) {
                    const oldOwner = this.countries.get(n.tile.countryId);
                    if (oldOwner) oldOwner.territories.delete(`${n.x},${n.y}`);
                    n.tile.countryId = country.id;
                    country.territories.add(`${n.x},${n.y}`);
                }
            });
        }
        this.cleanupBorderGore();
    }

    forceRandomConflict(country, type) {
        const neighbors = new Set();
        country.territories.forEach(key => {
            const [x, y] = key.split(',').map(Number);
            this.map.getNeighbors(x, y).forEach(n => {
                if (n.tile.countryId !== null && n.tile.countryId !== country.id) {
                    neighbors.add(n.tile.countryId);
                }
            });
        });

        if (neighbors.size > 0) {
            const targets = Array.from(neighbors);
            const targetId = targets[Math.floor(Math.random() * targets.size)];
            this.setRelation(country.id, targetId, type);
            console.log(`Focus effect: ${country.name} declared ${type} on neighbor!`);
        }
    }

    instigateNeighborRevolt(country) {
        const neighbors = new Set();
        country.territories.forEach(key => {
            const [x, y] = key.split(',').map(Number);
            this.map.getNeighbors(x, y).forEach(n => {
                if (n.tile.countryId !== null && n.tile.countryId !== country.id) {
                    neighbors.add(n.tile.countryId);
                }
            });
        });

        if (neighbors.size > 0) {
            const targets = Array.from(neighbors);
            const target = this.countries.get(targets[Math.floor(Math.random() * targets.size)]);
            if (target) this.triggerRevolt(target);
        }
    }

    cleanupBorderGore() {
        const changes = [];
        // Sparse global pass using Majority Rule Smoothing
        for (const [key, tile] of this.map.tiles.entries()) {
            if (tile.type === 'water') continue;
            
            const [x, y] = key.split(',').map(Number);
            const neighbors = this.map.getNeighbors(x, y);
            const counts = new Map();
            neighbors.forEach(n => {
                const id = n.tile.countryId;
                if (id !== null) counts.set(id, (counts.get(id) || 0) + 1);
            });

            let bestId = null;
            let maxN = 0;
            counts.forEach((c, id) => {
                if (c > maxN) {
                    maxN = c;
                    bestId = id;
                }
            });

            if (bestId !== null && bestId !== tile.countryId && maxN >= 3) {
                changes.push({ x, y, newId: bestId, oldId: tile.countryId });
            }
        }

        changes.forEach(c => {
            const tile = this.map.getTile(c.x, c.y);
            if (c.oldId !== null) {
                const oldC = this.countries.get(c.oldId);
                if (oldC) oldC.territories.delete(`${c.x},${c.y}`);
            }
            const newC = this.countries.get(c.newId);
            if (newC) {
                newC.territories.add(`${c.x},${c.y}`);
                tile.countryId = c.newId;
            }
        });
    }
}
