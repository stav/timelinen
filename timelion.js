/**
 * Family Tree + Timeline Visualization
 * Renders genealogy with time-based lifespan bars and relationship connectors
 */

(function () {
  'use strict';

  const CONFIG = {
    trackHeight: 50,           // Vertical space per track (person or couple)
    personHeight: 20,          // Height of lifespan bar
    axisHeight: 50,            // Height of time axis
    topPadding: 40,            // Top padding
    sidePadding: 40,           // Side padding
    minBarWidth: 40,           // Minimum width for lifespan bars
    connectorPadding: 16,      // Space between bar bottom and connector start
    unionOffset: 14,            // Vertical offset for younger partner in union
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let currentData = null;
  let computedLayout = null;

  // Collapsed state - tracks which unions have their children hidden
  // By default, all unions start collapsed (children rolled up)
  let collapsedUnions = new Set();
  let allUnionIds = new Set();

  // Zoom & pan state
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 4;
  const ZOOM_SENSITIVITY = 0.002;
  const PAN_SENSITIVITY = 1.5;

  // Drag state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;

  // Original time scale (for reset)
  let originalVisibleWindow = null;

  // ============ UTILITY FUNCTIONS ============

  function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function dateToX(date, startDate, endDate, width) {
    const totalSpan = endDate.getTime() - startDate.getTime();
    const dateSpan = date.getTime() - startDate.getTime();
    return CONFIG.sidePadding + (dateSpan / totalSpan) * width;
  }

  function createSVGElement(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    return el;
  }

  function getTimelineWidth() {
    const container = document.getElementById('timeline-container');
    if (!container) return 800;
    const containerWidth = container.clientWidth - 48;
    return Math.max(containerWidth - CONFIG.sidePadding * 2, 800);
  }

  // ============ COLLAPSE/EXPAND LOGIC ============

  /**
   * Initialize collapsed state - ALL unions with children are collapsed by default
   * The focal person and ancestors will still be visible due to isPersonVisible logic
   */
  function initializeCollapsedState(familyTree) {
    allUnionIds.clear();
    collapsedUnions.clear();
    
    const { unions } = familyTree;
    
    // Collapse ALL unions with children by default
    for (const union of unions) {
      if (union.children && union.children.length > 0) {
        allUnionIds.add(union.id);
        collapsedUnions.add(union.id);
      }
    }
  }

  /**
   * Get the union that a person is a child of (if any)
   */
  function getParentUnion(personId, familyTree) {
    for (const union of familyTree.unions) {
      if (union.children && union.children.includes(personId)) {
        return union;
      }
    }
    return null;
  }

  /**
   * Check if a person should be visible given current collapsed state.
   * A person is hidden if:
   * 1. They are a descendant of a collapsed union, OR
   * 2. They married into the family and ALL their partners are hidden
   */
  function isPersonVisible(personId, familyTree, generations, visited = new Set(), ancestorIds = null) {
    // Prevent infinite recursion
    if (visited.has(personId)) return false;
    visited.add(personId);
    
    const person = familyTree.people[personId];
    if (!person) return false;
    
    // Build ancestor IDs if not provided (cache for performance)
    if (ancestorIds === null) {
      ancestorIds = new Set([familyTree.focalPerson]);
      const queue = [familyTree.focalPerson];
      while (queue.length > 0) {
        const pid = queue.shift();
        const p = familyTree.people[pid];
        if (p && p.parentIds) {
          for (const parentId of p.parentIds) {
            if (!ancestorIds.has(parentId)) {
              ancestorIds.add(parentId);
              queue.push(parentId);
            }
          }
        }
      }
    }
    
    // Ancestors of the focal person are ALWAYS visible
    if (ancestorIds.has(personId)) {
      return true;
    }
    
    // Find the union this person is a child of
    const parentUnion = getParentUnion(personId, familyTree);
    
    if (parentUnion) {
      // Person is a child of a union in this tree
      
      // If parent union is collapsed, this person is hidden
      if (collapsedUnions.has(parentUnion.id)) return false;
      
      // Check if any ancestor in the parent union is also hidden
      // (cascading collapse - if grandparent union is collapsed, everyone below is hidden)
      for (const partnerId of parentUnion.partners) {
        if (!isPersonVisible(partnerId, familyTree, generations, new Set(visited), ancestorIds)) {
          return false;
        }
      }
      
      return true;
    } else {
      // Person has no parent union - they married INTO the family
      // They should only be visible if at least one of their partners is visible
      
      // Find all unions where this person is a partner
      const partnerUnions = familyTree.unions.filter(u => u.partners.includes(personId));
      
      if (partnerUnions.length === 0) {
        // Not connected to anyone - hide these orphaned entries
        return false;
      }
      
      // Check if at least one partner is visible
      for (const union of partnerUnions) {
        for (const partnerId of union.partners) {
          if (partnerId !== personId) {
            if (isPersonVisible(partnerId, familyTree, generations, new Set(visited), ancestorIds)) {
              return true;
            }
          }
        }
      }
      
      // All partners are hidden, so hide this spouse too
      return false;
    }
  }

  /**
   * Get all visible people given current collapsed state
   */
  function getVisiblePeople(familyTree, generations) {
    const visible = new Set();
    
    for (const personId of Object.keys(familyTree.people)) {
      if (isPersonVisible(personId, familyTree, generations)) {
        visible.add(personId);
      }
    }
    
    return visible;
  }

  /**
   * Count total descendants (including nested) of a union
   */
  function countDescendants(unionId, familyTree) {
    const union = familyTree.unions.find(u => u.id === unionId);
    if (!union || !union.children) return 0;
    
    let count = union.children.length;
    
    // Count descendants of each child
    for (const childId of union.children) {
      // Find unions where this child is a partner
      for (const childUnion of familyTree.unions) {
        if (childUnion.partners.includes(childId) && childUnion.children && childUnion.children.length > 0) {
          count += countDescendants(childUnion.id, familyTree);
        }
      }
    }
    
    return count;
  }

  /**
   * Toggle collapsed state for a union
   * If recursive is true, also expand/collapse all descendant unions
   */
  function toggleUnionCollapse(unionId, recursive = false) {
    const isCurrentlyCollapsed = collapsedUnions.has(unionId);
    
    if (recursive && currentData && currentData.familyTree) {
      // Recursively expand or collapse this union and all descendants
      const unionsToToggle = getDescendantUnions(unionId, currentData.familyTree);
      unionsToToggle.add(unionId);
      
      if (isCurrentlyCollapsed) {
        // Expand all
        for (const uid of unionsToToggle) {
          collapsedUnions.delete(uid);
        }
      } else {
        // Collapse all
        for (const uid of unionsToToggle) {
          collapsedUnions.add(uid);
        }
      }
    } else {
      // Just toggle this one union
      if (isCurrentlyCollapsed) {
        collapsedUnions.delete(unionId);
      } else {
        collapsedUnions.add(unionId);
      }
    }
    
    renderFamilyTree();
  }

  /**
   * Get all descendant union IDs for a given union
   */
  function getDescendantUnions(unionId, familyTree) {
    const descendants = new Set();
    const union = familyTree.unions.find(u => u.id === unionId);
    
    if (!union || !union.children) return descendants;
    
    // For each child, find unions where they are a partner
    for (const childId of union.children) {
      for (const childUnion of familyTree.unions) {
        if (childUnion.partners.includes(childId) && childUnion.children && childUnion.children.length > 0) {
          descendants.add(childUnion.id);
          // Recursively get descendants of this union
          const nested = getDescendantUnions(childUnion.id, familyTree);
          for (const nid of nested) {
            descendants.add(nid);
          }
        }
      }
    }
    
    return descendants;
  }

  /**
   * Expand all unions (show all descendants)
   */
  function expandAll() {
    collapsedUnions.clear();
    renderFamilyTree();
  }

  /**
   * Collapse all unions (hide all descendants)
   */
  function collapseAll() {
    if (currentData && currentData.familyTree) {
      initializeCollapsedState(currentData.familyTree);
      renderFamilyTree();
    }
  }

  // ============ GENERATION COMPUTATION ============

  /**
   * Compute generation numbers for all people relative to focal person.
   * Focal person = 0, parents = -1, grandparents = -2, children = +1, etc.
   */
  function computeGenerations(familyTree) {
    const { people, focalPerson, unions } = familyTree;
    const generations = {};
    
    // Start with focal person at generation 0
    generations[focalPerson] = 0;
    
    // Build child lookup from unions
    const childToParents = {};
    const parentToChildren = {};
    
    for (const union of unions) {
      for (const childId of union.children || []) {
        childToParents[childId] = union.partners;
      }
      for (const partnerId of union.partners) {
        if (!parentToChildren[partnerId]) parentToChildren[partnerId] = [];
        parentToChildren[partnerId].push(...(union.children || []));
      }
    }
    
    // Also use parentIds from people directly
    for (const [personId, person] of Object.entries(people)) {
      if (person.parentIds) {
        childToParents[personId] = person.parentIds;
        for (const parentId of person.parentIds) {
          if (!parentToChildren[parentId]) parentToChildren[parentId] = [];
          if (!parentToChildren[parentId].includes(personId)) {
            parentToChildren[parentId].push(personId);
          }
        }
      }
    }
    
    // BFS to assign generations
    const queue = [focalPerson];
    const visited = new Set([focalPerson]);
    
    while (queue.length > 0) {
      const current = queue.shift();
      const currentGen = generations[current];
      
      // Parents are one generation back (-1)
      const parents = childToParents[current] || [];
      for (const parentId of parents) {
        if (!visited.has(parentId) && people[parentId]) {
          generations[parentId] = currentGen - 1;
          visited.add(parentId);
          queue.push(parentId);
        }
      }
      
      // Children are one generation forward (+1)
      const children = parentToChildren[current] || [];
      for (const childId of children) {
        if (!visited.has(childId) && people[childId]) {
          generations[childId] = currentGen + 1;
          visited.add(childId);
          queue.push(childId);
        }
      }
      
      // Spouses share generation
      for (const union of unions) {
        if (union.partners.includes(current)) {
          for (const partnerId of union.partners) {
            if (!visited.has(partnerId) && people[partnerId]) {
              generations[partnerId] = currentGen;
              visited.add(partnerId);
              queue.push(partnerId);
            }
          }
        }
      }
    }
    
    return generations;
  }

  // ============ LAYOUT COMPUTATION ============

  /**
   * Build tracks: each person gets their own track, except married couples share a track.
   * Returns array of tracks, each track is { people: [ids], generation, unionId? }
   * Only includes visible people (respects collapsed state)
   */
  function buildTracks(familyTree, generations, visiblePeople) {
    const { people, unions } = familyTree;
    const tracks = [];
    const personToTrack = {}; // personId -> track index
    
    // First, create tracks for married couples (only if both partners are visible)
    for (const union of unions) {
      if (union.partners.length >= 2) {
        const [p1, p2] = union.partners;
        // Both partners must exist, be visible, and be in same generation
        if (people[p1] && people[p2] && 
            visiblePeople.has(p1) && visiblePeople.has(p2) &&
            generations[p1] === generations[p2]) {
          const trackIdx = tracks.length;
          tracks.push({
            people: [p1, p2],
            generation: generations[p1],
            unionId: union.id,
          });
          personToTrack[p1] = trackIdx;
          personToTrack[p2] = trackIdx;
        }
      }
    }
    
    // Then, create individual tracks for everyone not in a couple track (only if visible)
    for (const [personId, person] of Object.entries(people)) {
      if (personToTrack[personId] === undefined && visiblePeople.has(personId)) {
        const trackIdx = tracks.length;
        tracks.push({
          people: [personId],
          generation: generations[personId],
          unionId: null,
        });
        personToTrack[personId] = trackIdx;
      }
    }
    
    // Sort tracks by generation, then by earliest birth date in track
    tracks.sort((a, b) => {
      if (a.generation !== b.generation) return a.generation - b.generation;
      const aMinBirth = Math.min(...a.people.map(id => parseDate(people[id].birth).getTime()));
      const bMinBirth = Math.min(...b.people.map(id => parseDate(people[id].birth).getTime()));
      return aMinBirth - bMinBirth;
    });
    
    // Update personToTrack after sorting
    for (let i = 0; i < tracks.length; i++) {
      for (const personId of tracks[i].people) {
        personToTrack[personId] = i;
      }
    }
    
    return { tracks, personToTrack };
  }

  /**
   * Compute layout positions for all people and connectors.
   * Each person/couple gets their own track (horizontal row).
   */
  function computeLayout(familyTree, startDate, endDate, timelineWidth) {
    const { people, unions } = familyTree;
    const generations = computeGenerations(familyTree);
    
    // Get visible people based on collapsed state
    const visiblePeople = getVisiblePeople(familyTree, generations);
    
    // Build tracks (only for visible people)
    const { tracks, personToTrack } = buildTracks(familyTree, generations, visiblePeople);
    
    // Compute Y position for each track, accounting for union offsets
    const trackY = {};
    let currentY = CONFIG.topPadding;
    
    for (let i = 0; i < tracks.length; i++) {
      trackY[i] = currentY;
      
      // Calculate if this track has a union offset (affects spacing for next track)
      const track = tracks[i];
      const hasUnionOffset = track.people.length === 2;
      const trackEffectiveHeight = CONFIG.trackHeight + (hasUnionOffset ? CONFIG.unionOffset : 0);
      
      // Move to next track position, accounting for this track's effective height
      currentY += trackEffectiveHeight;
    }
    
    // Position people
    const personLayout = {};
    
    for (let trackIdx = 0; trackIdx < tracks.length; trackIdx++) {
      const track = tracks[trackIdx];
      const baseY = trackY[trackIdx];
      
      // For union tracks (2 people), determine who is older/younger
      let olderFirst = track.people;
      if (track.people.length === 2) {
        const [p1, p2] = track.people;
        const birth1 = parseDate(people[p1].birth).getTime();
        const birth2 = parseDate(people[p2].birth).getTime();
        // Sort so older (earlier birth) comes first
        olderFirst = birth1 <= birth2 ? [p1, p2] : [p2, p1];
      }
      
      for (let i = 0; i < olderFirst.length; i++) {
        const personId = olderFirst[i];
        const person = people[personId];
        const birthDate = parseDate(person.birth);
        const deathDate = person.death ? parseDate(person.death) : endDate;
        
        const x1 = dateToX(birthDate, startDate, endDate, timelineWidth);
        const x2 = dateToX(deathDate, startDate, endDate, timelineWidth);
        
        // Offset younger partner (second in sorted order) slightly down
        const yOffset = (olderFirst.length === 2 && i === 1) ? CONFIG.unionOffset : 0;
        const y = baseY + yOffset;
        
        personLayout[personId] = {
          id: personId,
          person,
          generation: generations[personId],
          trackIdx,
          track,
          x: x1,
          y: y,
          width: Math.max(x2 - x1, CONFIG.minBarWidth),
          barX1: x1,
          barX2: x2,
          centerX: (x1 + x2) / 2,
          centerY: y + CONFIG.personHeight / 2,
        };
      }
    }
    
    // Compute union connectors and collapse indicators
    const unionConnectors = [];
    const collapsedIndicators = []; // Unions with hidden children
    
    for (const union of unions) {
      const partnerLayouts = union.partners
        .map(id => personLayout[id])
        .filter(Boolean);
      
      // Skip if no visible partners
      if (partnerLayouts.length === 0) continue;
      
      // Check if this union has children
      const hasChildren = union.children && union.children.length > 0;
      const isCollapsed = collapsedUnions.has(union.id);
      
      // Parent-child connectors (only for visible children)
      const childLayouts = (union.children || [])
        .map(id => personLayout[id])
        .filter(Boolean);
      
      // Calculate parent center point (used for both connectors and collapse indicator)
      let parentCenterX;
      if (partnerLayouts.length >= 2) {
        const p1 = partnerLayouts[0];
        const p2 = partnerLayouts[1];
        const overlapStart = Math.max(p1.barX1, p2.barX1);
        const overlapEnd = Math.min(p1.barX2, p2.barX2);
        parentCenterX = (overlapStart + overlapEnd) / 2;
      } else {
        parentCenterX = partnerLayouts[0].centerX;
      }
      
      // Use the lowest Y position (for unions, the younger/lower partner)
      const maxY = Math.max(...partnerLayouts.map(p => p.y));
      const parentY = maxY + CONFIG.personHeight;
      
      // If union has children and is collapsed, add collapse indicator
      if (hasChildren && isCollapsed) {
        const descendantCount = countDescendants(union.id, familyTree);
        collapsedIndicators.push({
          unionId: union.id,
          x: parentCenterX,
          y: parentY + 8,
          count: descendantCount,
          directChildren: union.children.length,
        });
      }
      
      // Draw connectors only for visible children
      if (partnerLayouts.length > 0 && childLayouts.length > 0) {
        for (const child of childLayouts) {
          unionConnectors.push({
            type: 'parent-child',
            union,
            parentCenterX,
            parentY,
            parentTrackIdx: partnerLayouts[0].trackIdx,
            childCenterX: child.barX1,  // Use birth date position, not center
            childY: child.y,
            childTrackIdx: child.trackIdx,
            child,
          });
        }
      }
    }
    
    // Get generation boundaries for labels
    const genNumbers = [...new Set(Object.values(generations))].sort((a, b) => a - b);
    const minGen = Math.min(...genNumbers);
    const maxGen = Math.max(...genNumbers);
    
    // Map generation to first track in that generation
    const genFirstTrack = {};
    for (let i = 0; i < tracks.length; i++) {
      const gen = tracks[i].generation;
      if (genFirstTrack[gen] === undefined) {
        genFirstTrack[gen] = i;
      }
    }
    
    return {
      personLayout,
      unionConnectors,
      collapsedIndicators,
      generations,
      tracks,
      trackY,
      personToTrack,
      genNumbers,
      genFirstTrack,
      minGen,
      maxGen,
      visiblePeople,
      totalHeight: currentY + CONFIG.axisHeight,
    };
  }

  // ============ RENDERING ============

  // Counter for unique gradient IDs
  let gradientCounter = 0;

  /**
   * Get color for a generation based on rainbow palette
   * Red (oldest) → Orange → Yellow → Green → Blue → Purple
   */
  function getGenerationColor(generation, minGen) {
    const rainbowColors = [
      { fill: '#c94a4a', stroke: '#e66a6a' }, // Red
      { fill: '#d97a3a', stroke: '#f59a5a' }, // Orange
      { fill: '#b8952a', stroke: '#d9b54a' }, // Yellow (darker for better text contrast)
      { fill: '#4a7c59', stroke: '#7cb890' }, // Green
      { fill: '#3d5a80', stroke: '#5d8ab4' }, // Blue
      { fill: '#6a4a8a', stroke: '#8a6aaa' }, // Purple
    ];
    
    // Map generation to color index (oldest generation = red, then cycle through)
    const genOffset = generation - minGen;
    const colorIndex = genOffset % rainbowColors.length;
    return rainbowColors[colorIndex];
  }

  function renderPersonBar(svg, layout, startDate, endDate, timelineWidth, minGen, isFocal = false) {
    const { id, person, x, y, width, barX1, barX2, generation } = layout;
    const g = createSVGElement('g', { class: 'person' });
    
    // Determine bar style
    const isDeceased = person.death && parseDate(person.death) < new Date();
    const birthYear = parseInt(person.birth.split('-')[0]);
    
    // Check if this person needs a fade-out effect:
    // Born before 1920 and no death date recorded
    const needsFadeOut = !person.death && birthYear < 1920;
    
    // Check if person is still alive (at present)
    // Exclude historical persons without death dates (needsFadeOut)
    const isAlive = !needsFadeOut && (!person.death || parseDate(person.death) >= new Date());
    
    // Get colors based on generation
    const genColors = getGenerationColor(generation, minGen);
    let fillColor = genColors.fill;
    let strokeColor = genColors.stroke;
    
    let fill = fillColor;
    let strokeFill = strokeColor;
    
    // For fade-out, we'll adjust the bar end position and create gradient
    let effectiveBarX2 = barX2;
    
    // Create fade-out gradient for historical figures without death dates
    if (needsFadeOut) {
      const gradientId = `fade-${id}-${gradientCounter++}`;
      const strokeGradientId = `fade-stroke-${id}-${gradientCounter}`;
      
      // Calculate where ages 70 and 80 fall
      const birthDate = parseDate(person.birth);
      const age70Date = new Date(birthDate.getTime());
      age70Date.setFullYear(age70Date.getFullYear() + 70);
      const age80Date = new Date(birthDate.getTime());
      age80Date.setFullYear(age80Date.getFullYear() + 80);
      
      const age70X = dateToX(age70Date, startDate, endDate, timelineWidth);
      const age80X = dateToX(age80Date, startDate, endDate, timelineWidth);
      
      // Limit bar to age 80
      effectiveBarX2 = Math.min(barX2, age80X);
      
      const barStartX = barX1;
      const barWidth = effectiveBarX2 - barStartX;
      
      // Calculate fade start as percentage of the shortened bar width
      // Fade starts at age 70, ends at age 80 (which is now the bar end)
      const fadeStartPercent = Math.max(0, Math.min(100, ((age70X - barStartX) / barWidth) * 100));
      
      // Get or create defs element
      let defs = svg.querySelector('defs');
      if (!defs) {
        defs = createSVGElement('defs');
        svg.insertBefore(defs, svg.firstChild);
      }
      
      // Create gradient for fill
      const gradient = createSVGElement('linearGradient', {
        id: gradientId,
        x1: '0%', y1: '0%', x2: '100%', y2: '0%',
      });
      
      // Solid color until age 70
      const stop1 = createSVGElement('stop', {
        offset: `${fadeStartPercent}%`,
        'stop-color': fillColor,
        'stop-opacity': '1',
      });
      // Fade to fully transparent by age 80
      const stop2 = createSVGElement('stop', {
        offset: '100%',
        'stop-color': fillColor,
        'stop-opacity': '0',
      });
      
      gradient.appendChild(stop1);
      gradient.appendChild(stop2);
      defs.appendChild(gradient);
      
      // Create gradient for stroke
      const strokeGradient = createSVGElement('linearGradient', {
        id: strokeGradientId,
        x1: '0%', y1: '0%', x2: '100%', y2: '0%',
      });
      
      const strokeStop1 = createSVGElement('stop', {
        offset: `${fadeStartPercent}%`,
        'stop-color': strokeColor,
        'stop-opacity': '1',
      });
      const strokeStop2 = createSVGElement('stop', {
        offset: '100%',
        'stop-color': strokeColor,
        'stop-opacity': '0',
      });
      
      strokeGradient.appendChild(strokeStop1);
      strokeGradient.appendChild(strokeStop2);
      defs.appendChild(strokeGradient);
      
      fill = `url(#${gradientId})`;
      strokeFill = `url(#${strokeGradientId})`;
    }
    
    // Lifespan bar
    // For living people, use a path with square right end
    // For deceased people, use a rounded rect
    const finalBarWidth = Math.max(effectiveBarX2 - barX1, CONFIG.minBarWidth);
    const radius = CONFIG.personHeight / 2;
    let bar;
    
    if (isAlive && !needsFadeOut) {
      // Living person: path with rounded left side, square right side
      const pathData = [
        `M ${barX1 + radius},${y}`,  // Move to start of top line (after left rounding)
        `L ${barX1 + finalBarWidth},${y}`, // Line to top right (square corner)
        `L ${barX1 + finalBarWidth},${y + CONFIG.personHeight}`, // Line to bottom right (square corner)
        `L ${barX1 + radius},${y + CONFIG.personHeight}`, // Line to start of bottom line (before left rounding)
        `A ${radius},${radius} 0 0 1 ${barX1},${y + CONFIG.personHeight / 2}`, // Arc to middle-left
        `A ${radius},${radius} 0 0 1 ${barX1 + radius},${y}`, // Arc back to top-left
        'Z' // Close path
      ].join(' ');
      
      bar = createSVGElement('path', {
        class: 'person-bar',
        d: pathData,
        fill: fill,
        stroke: strokeFill,
        'stroke-width': 1.5,
      });
    } else {
      // Deceased or faded: fully rounded rect
      bar = createSVGElement('rect', {
        class: 'person-bar',
        x: barX1,
        y: y,
        width: finalBarWidth,
        height: CONFIG.personHeight,
        rx: radius,
        ry: radius,
        fill: fill,
        stroke: strokeFill,
        'stroke-width': 1.5,
      });
    }
    
    // Calculate age
    const birthDate = parseDate(person.birth);
    let age = null;
    let ageLabel = '';
    
    if (person.death) {
      // Age at death
      const deathDate = parseDate(person.death);
      age = deathDate.getFullYear() - birthDate.getFullYear();
      // Adjust if death was before birthday that year
      const deathMonth = deathDate.getMonth();
      const birthMonth = birthDate.getMonth();
      if (deathMonth < birthMonth || (deathMonth === birthMonth && deathDate.getDate() < birthDate.getDate())) {
        age--;
      }
      ageLabel = `${age}`;
    } else if (!needsFadeOut) {
      // Current age for living people
      const now = new Date();
      age = now.getFullYear() - birthDate.getFullYear();
      const nowMonth = now.getMonth();
      const birthMonth = birthDate.getMonth();
      if (nowMonth < birthMonth || (nowMonth === birthMonth && now.getDate() < birthDate.getDate())) {
        age--;
      }
      ageLabel = `${age}`;
    }
    // For needsFadeOut (historical, unknown death), don't show age
    
    // Tooltip
    const deathYear = person.death ? person.death.split('-')[0] : (needsFadeOut ? '?' : 'present');
    const ageInfo = ageLabel ? ` (age ${ageLabel})` : (needsFadeOut ? ' (age unknown)' : '');
    bar.innerHTML = `<title>${person.name}\n${birthYear} – ${deathYear}${ageInfo}</title>`;
    
    g.appendChild(bar);
    
    // Calculate available space for name (reserve minimal space for age)
    const leftPadding = 4;
    const rightPadding = 4; // Reduced right padding for age
    // Age is positioned at barX2 - rightPadding with text-anchor 'end', so it extends leftward
    // Reserve minimal space: age text width + tiny gap (1px)
    const ageLabelWidth = ageLabel ? (ageLabel.length * 5 + 1) : 0; // Age width + 1px gap
    const nameEndX = ageLabel ? (barX2 - rightPadding - ageLabelWidth) : (barX2 - rightPadding);
    const availableWidth = nameEndX - (barX1 + leftPadding);
    
    // Create clipPath for clean text clipping (prevents mid-letter chopping)
    const clipId = `clip-${id}-${gradientCounter++}`;
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = createSVGElement('defs');
      svg.insertBefore(defs, svg.firstChild);
    }
    const clipPath = createSVGElement('clipPath', { id: clipId });
    const clipRect = createSVGElement('rect', {
      x: barX1 + leftPadding,
      y: y,
      width: availableWidth,
      height: CONFIG.personHeight,
    });
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    
    // Name label (always inside bar, clipped with SVG clipPath)
    const label = createSVGElement('text', {
      class: 'person-label-inside',
      x: barX1 + leftPadding,
      y: y + CONFIG.personHeight / 2 + 1,
      'dominant-baseline': 'middle',
      fill: '#ffffff',
      'font-size': '10px',
      'font-weight': '500',
      'pointer-events': 'none',
      'clip-path': `url(#${clipId})`,
    });
    
    // Simple truncation: estimate and add ellipsis if needed (minimal JS)
    // Use a more accurate character width estimate based on average
    const avgCharWidth = 5; // More accurate for 10px font
    const ellipsisWidth = 4; // Width of "..." 
    const maxChars = Math.floor((availableWidth - ellipsisWidth) / avgCharWidth);
    
    if (person.name.length * avgCharWidth > availableWidth) {
      label.textContent = person.name.substring(0, Math.max(1, maxChars)).trim() + '...';
    } else {
      label.textContent = person.name;
    }
    
    g.appendChild(label);
    
    // Age label on right side of bar (for deceased or living, not for faded historical)
    const barWidth = barX2 - barX1;
    if (ageLabel && barWidth > 30) {
      const ageText = createSVGElement('text', {
        class: 'person-age-label',
        x: barX2 - 4,
        y: y + CONFIG.personHeight / 2 + 1,
        'dominant-baseline': 'middle',
        'text-anchor': 'end',
        fill: 'rgba(255, 255, 255, 0.7)',
        'font-size': '9px',
        'font-weight': '400',
        'pointer-events': 'none',
      });
      ageText.textContent = ageLabel;
      g.appendChild(ageText);
    }
    
    svg.appendChild(g);
    return g;
  }

  /**
   * Render collapse/expand indicators for unions with hidden children
   */
  function renderCollapseIndicators(svg, layout, familyTree) {
    const g = createSVGElement('g', { class: 'collapse-indicators' });
    
    for (const indicator of layout.collapsedIndicators) {
      const { unionId, x, y, count, directChildren } = indicator;
      
      // Create clickable group
      const clickGroup = createSVGElement('g', {
        class: 'collapse-indicator',
        style: 'cursor: pointer;',
        'data-union-id': unionId,
      });
      
      // Background pill
      const pillWidth = 36 + (count > 9 ? 8 : 0);
      const pill = createSVGElement('rect', {
        x: x - pillWidth / 2,
        y: y - 10,
        width: pillWidth,
        height: 20,
        rx: 10,
        ry: 10,
        fill: 'rgba(184, 156, 107, 0.4)',
        stroke: 'rgba(184, 156, 107, 0.6)',
        'stroke-width': 1,
      });
      clickGroup.appendChild(pill);
      
      // Plus icon
      const plus = createSVGElement('text', {
        x: x - pillWidth / 2 + 10,
        y: y + 4,
        fill: '#c9b896',
        'font-size': '14px',
        'font-weight': 'bold',
        'text-anchor': 'middle',
        'pointer-events': 'none',
      });
      plus.textContent = '+';
      clickGroup.appendChild(plus);
      
      // Count label
      const label = createSVGElement('text', {
        x: x + 4,
        y: y + 3,
        fill: '#c9b896',
        'font-size': '10px',
        'text-anchor': 'middle',
        'pointer-events': 'none',
      });
      label.textContent = count.toString();
      clickGroup.appendChild(label);
      
      // Tooltip
      const title = createSVGElement('title');
      title.textContent = `Click to show ${directChildren} ${directChildren === 1 ? 'child' : 'children'} (${count} total descendants)\nCtrl+click to expand all descendants`;
      clickGroup.appendChild(title);
      
      // Click handler (Ctrl+click for recursive expand)
      clickGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUnionCollapse(unionId, e.ctrlKey || e.metaKey);
      });
      
      // Hover effect
      clickGroup.addEventListener('mouseenter', () => {
        pill.setAttribute('fill', 'rgba(184, 156, 107, 1)');
        plus.setAttribute('fill', '#2a2520');
        label.setAttribute('fill', '#2a2520');
      });
      clickGroup.addEventListener('mouseleave', () => {
        pill.setAttribute('fill', 'rgba(184, 156, 107, 0.4)');
        plus.setAttribute('fill', '#c9b896');
        label.setAttribute('fill', '#c9b896');
      });
      
      g.appendChild(clickGroup);
    }
    
    // Also render "collapse" buttons for expanded unions with visible children
    for (const union of familyTree.unions) {
      if (!union.children || union.children.length === 0) continue;
      if (collapsedUnions.has(union.id)) continue; // Already collapsed
      
      // Check if at least one partner is visible
      const visiblePartners = union.partners.filter(id => layout.personLayout[id]);
      if (visiblePartners.length === 0) continue;
      
      // Check if at least one child is visible
      const visibleChildren = union.children.filter(id => layout.personLayout[id]);
      if (visibleChildren.length === 0) continue;
      
      const partnerLayouts = visiblePartners.map(id => layout.personLayout[id]);
      
      // Calculate center point
      let parentCenterX;
      if (partnerLayouts.length >= 2) {
        const p1 = partnerLayouts[0];
        const p2 = partnerLayouts[1];
        const overlapStart = Math.max(p1.barX1, p2.barX1);
        const overlapEnd = Math.min(p1.barX2, p2.barX2);
        parentCenterX = (overlapStart + overlapEnd) / 2;
      } else {
        parentCenterX = partnerLayouts[0].centerX;
      }
      
      // Use the lowest Y position (for unions, the younger/lower partner)
      const maxY = Math.max(...partnerLayouts.map(p => p.y));
      const parentY = maxY + CONFIG.personHeight;
      const descendantCount = countDescendants(union.id, familyTree);
      
      // Create collapse button (minus sign with count)
      const collapseGroup = createSVGElement('g', {
        class: 'collapse-button',
        style: 'cursor: pointer;',
        'data-union-id': union.id,
      });
      
      // Background pill (same style as collapsed indicator)
      const pillWidth = 36 + (descendantCount > 9 ? 8 : 0);
      const collapsePill = createSVGElement('rect', {
        x: parentCenterX - pillWidth / 2,
        y: parentY - 2,
        width: pillWidth,
        height: 20,
        rx: 10,
        ry: 10,
        fill: 'rgba(100, 100, 100, 0.4)',
        stroke: 'rgba(150, 150, 150, 0.6)',
        'stroke-width': 1,
      });
      collapseGroup.appendChild(collapsePill);
      
      // Minus icon
      const minus = createSVGElement('text', {
        x: parentCenterX - pillWidth / 2 + 10,
        y: parentY + 12,
        fill: 'rgba(200, 200, 200, 0.6)',
        'font-size': '14px',
        'font-weight': 'bold',
        'text-anchor': 'middle',
        'pointer-events': 'none',
      });
      minus.textContent = '−';
      collapseGroup.appendChild(minus);
      
      // Count label
      const countLabel = createSVGElement('text', {
        x: parentCenterX + 4,
        y: parentY + 11,
        fill: 'rgba(200, 200, 200, 0.6)',
        'font-size': '10px',
        'text-anchor': 'middle',
        'pointer-events': 'none',
      });
      countLabel.textContent = descendantCount.toString();
      collapseGroup.appendChild(countLabel);
      
      const collapseTitle = createSVGElement('title');
      collapseTitle.textContent = `Click to hide ${union.children.length} ${union.children.length === 1 ? 'child' : 'children'} (${descendantCount} total descendants)\nCtrl+click to collapse all descendants`;
      collapseGroup.appendChild(collapseTitle);
      
      // Click handler (Ctrl+click for recursive collapse)
      collapseGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUnionCollapse(union.id, e.ctrlKey || e.metaKey);
      });
      
      collapseGroup.addEventListener('mouseenter', () => {
        collapsePill.setAttribute('fill', 'rgba(100, 100, 100, 1)');
        minus.setAttribute('fill', '#ffffff');
        countLabel.setAttribute('fill', '#ffffff');
      });
      collapseGroup.addEventListener('mouseleave', () => {
        collapsePill.setAttribute('fill', 'rgba(100, 100, 100, 0.4)');
        minus.setAttribute('fill', 'rgba(200, 200, 200, 0.6)');
        countLabel.setAttribute('fill', 'rgba(200, 200, 200, 0.6)');
      });
      
      g.appendChild(collapseGroup);
    }
    
    svg.appendChild(g);
  }

  function renderConnectors(svg, layout) {
    const g = createSVGElement('g', { class: 'connectors' });
    
    // Group connectors by union so we can draw shared horizontal lines
    const connectorsByUnion = {};
    for (const connector of layout.unionConnectors) {
      if (connector.type === 'parent-child') {
        const unionId = connector.union.id;
        if (!connectorsByUnion[unionId]) {
          connectorsByUnion[unionId] = [];
        }
        connectorsByUnion[unionId].push(connector);
      }
    }
    
    // Draw connectors for each union
    for (const [unionId, connectors] of Object.entries(connectorsByUnion)) {
      if (connectors.length === 0) continue;
      
      const { parentCenterX, parentY } = connectors[0];
      
      // Horizontal line Y is just below the parent track (in the gap between generations)
      const horizontalY = parentY + CONFIG.connectorPadding;
      
      // Find the leftmost and rightmost child X positions
      const childXs = connectors.map(c => c.childCenterX);
      const minChildX = Math.min(...childXs);
      const maxChildX = Math.max(...childXs);
      
      // Draw vertical line down from parent to horizontal line level
      const parentDrop = createSVGElement('line', {
        x1: parentCenterX,
        y1: parentY + 4,
        x2: parentCenterX,
        y2: horizontalY,
        stroke: 'rgba(200, 180, 150, 0.6)',
        'stroke-width': 1.5,
      });
      g.appendChild(parentDrop);
      
      // Draw horizontal line spanning all children
      if (connectors.length > 1 || parentCenterX !== minChildX) {
        const horizLine = createSVGElement('line', {
          x1: Math.min(parentCenterX, minChildX),
          y1: horizontalY,
          x2: Math.max(parentCenterX, maxChildX),
          y2: horizontalY,
          stroke: 'rgba(200, 180, 150, 0.6)',
          'stroke-width': 1.5,
        });
        g.appendChild(horizLine);
      }
      
      // Draw vertical drops to each child
      for (const connector of connectors) {
        const { childCenterX, childY } = connector;
        
        const childDrop = createSVGElement('line', {
          x1: childCenterX,
          y1: horizontalY,
          x2: childCenterX,
          y2: childY - 2,
          stroke: 'rgba(200, 180, 150, 0.6)',
          'stroke-width': 1.5,
        });
        g.appendChild(childDrop);
        
        // Small dot at child end
        const dot = createSVGElement('circle', {
          cx: childCenterX,
          cy: childY - 2,
          r: 3,
          fill: 'rgba(200, 180, 150, 0.8)',
        });
        g.appendChild(dot);
      }
    }
    
    svg.appendChild(g);
  }

  function renderGenerationLabels(svg, layout) {
    const g = createSVGElement('g', { class: 'generation-labels' });
    
    const genLabels = {
      '-4': 'GGG-Grandparents',
      '-3': 'GG-Grandparents',
      '-2': 'Grandparents',
      '-1': 'Parents',
      '0': 'You',
      '1': 'Children',
      '2': 'Grandchildren',
    };
    
    for (const gen of layout.genNumbers) {
      // Get Y position from first track in this generation
      const firstTrackIdx = layout.genFirstTrack[gen];
      if (firstTrackIdx === undefined) continue;
      
      const y = layout.trackY[firstTrackIdx] + CONFIG.personHeight / 2;
      const label = createSVGElement('text', {
        class: 'gen-label',
        x: 10,
        y: y,
        'dominant-baseline': 'middle',
        fill: 'rgba(255, 255, 255, 0.3)',
        'font-size': '11px',
        'font-style': 'italic',
      });
      label.textContent = genLabels[gen.toString()] || `Gen ${gen}`;
      g.appendChild(label);
    }
    
    svg.appendChild(g);
  }

  function renderAxis(svg, startDate, endDate, timelineWidth, yPosition) {
    const g = createSVGElement('g', {
      class: 'axis',
      transform: `translate(0, ${yPosition})`,
    });

    // Axis line
    const axisLine = createSVGElement('line', {
      class: 'axis-line',
      x1: CONFIG.sidePadding,
      y1: 0,
      x2: CONFIG.sidePadding + timelineWidth,
      y2: 0,
      stroke: 'rgba(255, 255, 255, 0.3)',
      'stroke-width': 2,
    });
    g.appendChild(axisLine);

    // Generate ticks
    const totalYears = endDate.getFullYear() - startDate.getFullYear();
    let interval;
    if (totalYears > 200) interval = 50;
    else if (totalYears > 100) interval = 25;
    else if (totalYears > 50) interval = 10;
    else if (totalYears > 20) interval = 5;
    else interval = 1;

    const startYear = Math.ceil(startDate.getFullYear() / interval) * interval;
    
    for (let year = startYear; year <= endDate.getFullYear(); year += interval) {
      const date = new Date(year, 0, 1);
      if (date >= startDate && date <= endDate) {
        const x = dateToX(date, startDate, endDate, timelineWidth);
        const isMajor = year % (interval * 2) === 0 || interval >= 25;
        const tickHeight = isMajor ? 12 : 8;

        const tick = createSVGElement('line', {
          x1: x, y1: 0, x2: x, y2: tickHeight,
          stroke: 'rgba(255, 255, 255, 0.25)',
          'stroke-width': 1,
        });
        g.appendChild(tick);

        const label = createSVGElement('text', {
          x: x,
          y: tickHeight + 14,
          'text-anchor': 'middle',
          fill: isMajor ? '#c9b896' : '#a0a0a0',
          'font-size': isMajor ? '12px' : '11px',
        });
        label.textContent = year.toString();
        g.appendChild(label);
      }
    }

    svg.appendChild(g);
  }

  // ============ MAIN RENDER ============

  function renderFamilyTree() {
    const container = document.getElementById('timeline-container');
    
    if (!document.getElementById('timeline')) {
      container.innerHTML = '<svg id="timeline"></svg>';
    }
    
    const svg = document.getElementById('timeline');
    svg.innerHTML = '';

    if (!currentData || !currentData.familyTree) {
      container.innerHTML = '<div class="error-message">No family tree data loaded.</div>';
      return;
    }

    const { familyTree, visibleWindow } = currentData;
    const startDate = parseDate(visibleWindow.startDate);
    const endDate = parseDate(visibleWindow.endDate);

    const timelineWidth = getTimelineWidth();

    // Compute layout
    const layout = computeLayout(familyTree, startDate, endDate, timelineWidth);
    computedLayout = layout;

    // Set SVG size
    const svgWidth = CONFIG.sidePadding * 2 + timelineWidth;
    const svgHeight = layout.totalHeight;
    
    svg.setAttribute('width', svgWidth);
    svg.setAttribute('height', svgHeight);
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    // Create content group for zoom/pan transforms
    const contentGroup = createSVGElement('g', { id: 'timeline-content' });
    svg.appendChild(contentGroup);

    // Render generation labels (behind everything)
    renderGenerationLabels(contentGroup, layout);

    // Render people bars
    for (const [personId, personLayout] of Object.entries(layout.personLayout)) {
      const isFocal = personId === familyTree.focalPerson;
      renderPersonBar(contentGroup, personLayout, startDate, endDate, timelineWidth, layout.minGen, isFocal);
    }

    // Render connectors on top of bars so they're visible
    renderConnectors(contentGroup, layout);
    
    // Render collapse/expand indicators
    renderCollapseIndicators(contentGroup, layout, familyTree);

    // Render time axis
    const axisY = layout.totalHeight - CONFIG.axisHeight + 10;
    renderAxis(contentGroup, startDate, endDate, timelineWidth, axisY);

    // Apply current zoom transform
    applyZoomTransform();
  }

  // ============ INITIALIZATION ============

  function init() {
    const container = document.getElementById('timeline-container');
    
    if (typeof window.familyTree !== 'undefined' && typeof window.visibleWindow !== 'undefined') {
      currentData = {
        familyTree: window.familyTree,
        visibleWindow: window.visibleWindow,
      };
      
      // Store original visible window for reset
      originalVisibleWindow = {
        startDate: window.visibleWindow.startDate,
        endDate: window.visibleWindow.endDate,
      };
      
      // Initialize collapsed state - all unions collapsed by default
      initializeCollapsedState(window.familyTree);
      
      renderFamilyTree();
    } else {
      container.innerHTML = '<div class="error-message">Data file missing familyTree or visibleWindow.</div>';
    }
    
    initZoomControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Handle resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(renderFamilyTree, 150);
  });

  // Zoom, scroll, and drag controls
  function initZoomControls() {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    // Cursor guide - simple native transform update
    const cursorGuide = document.getElementById('cursor-guide');
    if (cursorGuide) {
      container.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        cursorGuide.style.transform = `translateX(${x}px)`;
        
        // Calculate date from X position
        if (currentData && currentData.visibleWindow) {
          const timelineWidth = getTimelineWidth();
          // Account for container padding (1.5rem = 24px) and SVG sidePadding
          const containerPadding = 24;
          const svgX = (x - containerPadding - panX) / zoomLevel;
          const timelineX = svgX - CONFIG.sidePadding;
          const ratio = timelineX / timelineWidth;
          
          if (ratio >= 0 && ratio <= 1) {
            const startDate = parseDate(currentData.visibleWindow.startDate);
            const endDate = parseDate(currentData.visibleWindow.endDate);
            const totalSpan = endDate.getTime() - startDate.getTime();
            const date = new Date(startDate.getTime() + ratio * totalSpan);
            cursorGuide.dataset.date = date.getFullYear();
          } else {
            cursorGuide.dataset.date = '';
          }
        }
      });
    }

    // Wheel events: Alt+wheel = visual zoom, Ctrl+wheel = time scale zoom, Shift+wheel = horizontal pan, wheel = vertical pan
    container.addEventListener('wheel', (e) => {
      const svg = document.getElementById('timeline');
      if (!svg) return;

      if (e.ctrlKey) {
        // Ctrl+wheel: time scale zoom (adjusts start/end dates)
        e.preventDefault();
        
        if (!currentData || !currentData.visibleWindow) return;

        const startDate = parseDate(currentData.visibleWindow.startDate);
        const endDate = parseDate(currentData.visibleWindow.endDate);
        const totalSpan = endDate.getTime() - startDate.getTime();

        // Get mouse position relative to timeline area
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        
        const timelineWidth = getTimelineWidth();
        
        // Calculate where in the timeline the mouse is (0 to 1)
        const timelineX = mouseX - CONFIG.sidePadding;
        const mouseRatio = Math.max(0, Math.min(1, timelineX / timelineWidth));
        
        // Calculate the date under the mouse
        const mouseTime = startDate.getTime() + (mouseRatio * totalSpan);

        // Zoom factor: scroll up = zoom in (smaller range), scroll down = zoom out (larger range)
        const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87; // ~15% zoom per scroll step
        
        // Calculate new span
        const newSpan = totalSpan * zoomFactor;
        
        // Minimum span: 30 days, maximum span: 2000 years
        const minSpan = 30 * 24 * 60 * 60 * 1000;
        const maxSpan = 2000 * 365.25 * 24 * 60 * 60 * 1000;
        
        if (newSpan < minSpan || newSpan > maxSpan) return;

        // Calculate new start and end dates, keeping the mouse position fixed
        const newStartTime = mouseTime - (mouseRatio * newSpan);
        const newEndTime = mouseTime + ((1 - mouseRatio) * newSpan);
        
        const newStartDate = new Date(newStartTime);
        const newEndDate = new Date(newEndTime);

        // Format dates back to YYYY-MM-DD strings
        const formatDate = (d) => {
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };

        // Update the visible window
        currentData.visibleWindow.startDate = formatDate(newStartDate);
        currentData.visibleWindow.endDate = formatDate(newEndDate);

        // Re-render
        renderFamilyTree();
      } else if (e.altKey) {
        // Alt+wheel: visual zoom (transform-based)
        e.preventDefault();
        
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const delta = -e.deltaY * ZOOM_SENSITIVITY;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel * (1 + delta)));
        
        if (newZoom === zoomLevel) return;
        
        // Zoom toward cursor position
        const zoomFactor = newZoom / zoomLevel;
        panX = mouseX - (mouseX - panX) * zoomFactor;
        panY = mouseY - (mouseY - panY) * zoomFactor;
        
        zoomLevel = newZoom;
        applyZoomTransform();
      } else if (e.shiftKey) {
        // Shift+wheel: horizontal pan
        e.preventDefault();
        panX -= e.deltaY * PAN_SENSITIVITY;
        applyZoomTransform();
      } else {
        // Regular wheel: vertical pan
        e.preventDefault();
        panY -= e.deltaY * PAN_SENSITIVITY;
        applyZoomTransform();
      }
    }, { passive: false });

    // Drag to pan
    container.addEventListener('mousedown', (e) => {
      // Only start drag on primary button and not on interactive elements
      if (e.button !== 0) return;
      
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      container.classList.add('dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      
      panX = panStartX + dx;
      panY = panStartY + dy;
      applyZoomTransform();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        container.classList.remove('dragging');
      }
    });

    // Prevent context menu interfering with drag
    container.addEventListener('contextmenu', (e) => {
      if (isDragging) e.preventDefault();
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        resetZoom();
      } else if (e.key === 'e' || e.key === 'E') {
        // E = Expand all
        expandAll();
      } else if (e.key === 'c' || e.key === 'C') {
        // C = Collapse all (to initial state)
        collapseAll();
      }
    });
  }

  function updateViewStats() {
    const zoomEl = document.getElementById('stat-zoom');
    const panEl = document.getElementById('stat-pan');
    const scaleEl = document.getElementById('stat-scale');
    
    if (zoomEl) zoomEl.textContent = zoomLevel.toFixed(2);
    if (panEl) panEl.textContent = `${Math.round(panX)}, ${Math.round(panY)}`;
    
    // Calculate and display time scale factor
    if (scaleEl && currentData && currentData.visibleWindow && originalVisibleWindow) {
      const currentStart = parseDate(currentData.visibleWindow.startDate);
      const currentEnd = parseDate(currentData.visibleWindow.endDate);
      const originalStart = parseDate(originalVisibleWindow.startDate);
      const originalEnd = parseDate(originalVisibleWindow.endDate);
      
      const currentSpan = currentEnd.getTime() - currentStart.getTime();
      const originalSpan = originalEnd.getTime() - originalStart.getTime();
      
      const scaleFactor = originalSpan / currentSpan;
      scaleEl.textContent = scaleFactor.toFixed(2) + 'x';
    }
  }

  function applyZoomTransform() {
    const content = document.getElementById('timeline-content');
    if (!content) return;
    
    content.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoomLevel})`);
    updateViewStats();
  }

  function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    
    // Also reset time scale to original
    if (currentData && currentData.visibleWindow && originalVisibleWindow) {
      currentData.visibleWindow.startDate = originalVisibleWindow.startDate;
      currentData.visibleWindow.endDate = originalVisibleWindow.endDate;
      renderFamilyTree();
    } else {
      applyZoomTransform();
    }
  }

  // Expose for debugging and external control
  window.renderFamilyTree = renderFamilyTree;
  window.resetZoom = resetZoom;
  window.expandAll = expandAll;
  window.collapseAll = collapseAll;
  window.toggleUnionCollapse = toggleUnionCollapse;
})();

