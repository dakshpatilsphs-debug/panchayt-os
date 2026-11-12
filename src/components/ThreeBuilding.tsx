import { useEffect, useRef, useState } from "react";
import type { Member } from "../lib/types";
import { getFlatFloor } from "../lib/util";

interface ThreeBuildingProps {
  members?: Member[];
  selectedWing?: string;
  selectedFlat?: string;
  societyName?: string;
  onSelectUnit?: (wing: string, flat: string) => void;
}

export default function ThreeBuilding({
  members = [],
  selectedWing = "A",
  selectedFlat = "",
  societyName = "Royal Palms Co-Operative Housing Society",
  onSelectUnit,
}: ThreeBuildingProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [duskMode, setDuskMode] = useState(false);
  const [floorElevation, setFloorElevation] = useState(2);
  const [hoveredInfo, setHoveredInfo] = useState<{
    unit: string;
    owner: string;
    due: number;
    x: number;
    y: number;
  } | null>(null);

  const sceneRefs = useRef<{
    renderer?: any;
    camera?: any;
    scene?: any;
    interactiveWindows?: any[];
    sunLight?: any;
    ambientLight?: any;
    resetOrbit?: () => void;
    setCameraElevation?: (floor: number) => void;
    animId?: number;
  }>({});

  // Compute overall max floor across all inputted members
  const maxOverallFloor = Math.max(
    1,
    ...members.filter((m) => m.active).map((m) => getFlatFloor(m.flat, m.floor)),
    4
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined" || !(window as any).THREE) return;

    const THREE = (window as any).THREE;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    // Bright Sunny Daylight Sky Atmosphere
    scene.background = new THREE.Color(0x9ed3ff);
    scene.fog = new THREE.FogExp2(0xd0e8ff, 0.005);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 1200);
    camera.position.set(52, 38, 58);
    camera.lookAt(0, 10, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // ==========================================
    // 1. SUN & REALISTIC DAYLIGHT ILLUMINATION
    // ==========================================
    // Visible Glowing 3D Sun in the sky
    const sunGroup = new THREE.Group();
    sunGroup.position.set(90, 130, 70);

    const sunCoreGeo = new THREE.SphereGeometry(9, 32, 32);
    const sunCoreMat = new THREE.MeshBasicMaterial({ color: 0xfffae0 });
    const sunCore = new THREE.Mesh(sunCoreGeo, sunCoreMat);
    sunGroup.add(sunCore);

    // Glowing outer sun corona
    const sunCoronaGeo = new THREE.SphereGeometry(18, 32, 32);
    const sunCoronaMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.35,
      side: THREE.BackSide,
    });
    const sunCorona = new THREE.Mesh(sunCoronaGeo, sunCoronaMat);
    sunGroup.add(sunCorona);
    scene.add(sunGroup);

    // Directional Sunlight casting crisp building & tree shadows
    const sunLight = new THREE.DirectionalLight(0xfffaea, 2.3);
    sunLight.position.set(90, 130, 70);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 300;
    sunLight.shadow.camera.left = -90;
    sunLight.shadow.camera.right = 90;
    sunLight.shadow.camera.top = 90;
    sunLight.shadow.camera.bottom = -90;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    // Sky to Ground natural Hemisphere Ambient Light
    const ambientLight = new THREE.HemisphereLight(0xbae6fd, 0x86efac, 1.2);
    scene.add(ambientLight);

    // Warm golden architectural bounce light
    const bounceLight = new THREE.DirectionalLight(0xfef3c7, 0.7);
    bounceLight.position.set(-50, 40, -40);
    scene.add(bounceLight);

    // ==========================================
    // 2. VIBRANT GROUND, LANDSCAPING & ROADS
    // ==========================================
    // Outer Estate Green Grass Field
    const grassGeo = new THREE.PlaneGeometry(240, 240);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x3bb54a,
      roughness: 0.85,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(grassGeo, grassMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Elevated Manicured Central Courtyard Podium
    const podiumGeo = new THREE.BoxGeometry(68, 0.7, 56);
    const podiumMat = new THREE.MeshStandardMaterial({ color: 0x2e9b3d, roughness: 0.8 });
    const podium = new THREE.Mesh(podiumGeo, podiumMat);
    podium.position.set(0, 0.35, -4);
    podium.receiveShadow = true;
    scene.add(podium);

    // Paved Stone Pathways through the courtyard
    const walkwayGeo = new THREE.BoxGeometry(5, 0.75, 48);
    const walkwayMat = new THREE.MeshStandardMaterial({ color: 0xefe9df, roughness: 0.6 });
    const walkway = new THREE.Mesh(walkwayGeo, walkwayMat);
    walkway.position.set(0, 0.38, -4);
    walkway.receiveShadow = true;
    scene.add(walkway);

    // Cross Pathway connecting towers
    const crossWalkwayGeo = new THREE.BoxGeometry(60, 0.74, 5);
    const crossWalkway = new THREE.Mesh(crossWalkwayGeo, walkwayMat);
    crossWalkway.position.set(0, 0.38, -8);
    crossWalkway.receiveShadow = true;
    scene.add(crossWalkway);

    // Modern Swimming Pool
    const poolSurroundGeo = new THREE.BoxGeometry(22, 0.75, 12);
    const poolSurroundMat = new THREE.MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.4 });
    const poolSurround = new THREE.Mesh(poolSurroundGeo, poolSurroundMat);
    poolSurround.position.set(0, 0.38, 10);
    poolSurround.receiveShadow = true;
    scene.add(poolSurround);

    const poolWaterGeo = new THREE.BoxGeometry(18, 0.82, 8);
    const poolWaterMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.85,
    });
    const poolWater = new THREE.Mesh(poolWaterGeo, poolWaterMat);
    poolWater.position.set(0, 0.42, 10);
    scene.add(poolWater);

    // Luxury Clubhouse
    const clubGeo = new THREE.BoxGeometry(20, 5, 13);
    const clubMat = new THREE.MeshStandardMaterial({ color: 0xfefefe, roughness: 0.25, metalness: 0.1 });
    const club = new THREE.Mesh(clubGeo, clubMat);
    club.position.set(0, 2.85, -20);
    club.castShadow = true;
    club.receiveShadow = true;
    scene.add(club);

    // Clubhouse Glass Facade
    const clubGlassGeo = new THREE.BoxGeometry(16, 3.2, 0.4);
    const clubGlassMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.5,
      transparent: true,
      opacity: 0.7,
    });
    const clubGlass = new THREE.Mesh(clubGlassGeo, clubGlassMat);
    clubGlass.position.set(0, 2.5, -13.3);
    scene.add(clubGlass);

    // ==========================================
    // 3. ASPHALT ROADS, MARKINGS & SIDEWALKS
    // ==========================================
    const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x2e353e, roughness: 0.8 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xd6d3cc, roughness: 0.7 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const yellowStripeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

    // West Road (North-South)
    const roadNSGeo = new THREE.BoxGeometry(8, 0.1, 110);
    const roadWest = new THREE.Mesh(roadNSGeo, asphaltMat);
    roadWest.position.set(-44, 0.05, 8);
    roadWest.receiveShadow = true;
    scene.add(roadWest);

    // East Road (North-South)
    const roadEast = new THREE.Mesh(roadNSGeo, asphaltMat);
    roadEast.position.set(44, 0.05, 8);
    roadEast.receiveShadow = true;
    scene.add(roadEast);

    // South Boulevard Road (East-West)
    const roadEWGeo = new THREE.BoxGeometry(96, 0.1, 9);
    const roadSouth = new THREE.Mesh(roadEWGeo, asphaltMat);
    roadSouth.position.set(0, 0.05, 52);
    roadSouth.receiveShadow = true;
    scene.add(roadSouth);

    // North Perimeter Road
    const roadNorth = new THREE.Mesh(roadEWGeo, asphaltMat);
    roadNorth.position.set(0, 0.05, -42);
    roadNorth.receiveShadow = true;
    scene.add(roadNorth);

    // Entrance Avenue connecting south boulevard to the society
    const roadAvenueGeo = new THREE.BoxGeometry(9, 0.1, 26);
    const roadAvenue = new THREE.Mesh(roadAvenueGeo, asphaltMat);
    roadAvenue.position.set(0, 0.06, 38);
    roadAvenue.receiveShadow = true;
    scene.add(roadAvenue);

    // Sidewalk curbs along the avenue
    const curbGeo = new THREE.BoxGeometry(0.8, 0.25, 26);
    const curbLeft = new THREE.Mesh(curbGeo, sidewalkMat);
    curbLeft.position.set(-4.9, 0.12, 38);
    curbLeft.receiveShadow = true;
    scene.add(curbLeft);

    const curbRight = new THREE.Mesh(curbGeo, sidewalkMat);
    curbRight.position.set(4.9, 0.12, 38);
    curbRight.receiveShadow = true;
    scene.add(curbRight);

    // White dashed lane markings on the roads
    for (let z = -36; z <= 50; z += 6) {
      const dashGeo = new THREE.BoxGeometry(0.3, 0.12, 3);
      const dashW = new THREE.Mesh(dashGeo, stripeMat);
      dashW.position.set(-44, 0.07, z);
      scene.add(dashW);

      const dashE = new THREE.Mesh(dashGeo, stripeMat);
      dashE.position.set(44, 0.07, z);
      scene.add(dashE);
    }

    for (let x = -40; x <= 40; x += 6) {
      const dashGeo = new THREE.BoxGeometry(3, 0.12, 0.3);
      const dashS = new THREE.Mesh(dashGeo, stripeMat);
      dashS.position.set(x, 0.07, 52);
      scene.add(dashS);
    }

    // Pedestrian Zebra Crossing in front of the gate
    for (let x = -3.8; x <= 3.8; x += 1.1) {
      const zebraGeo = new THREE.BoxGeometry(0.65, 0.12, 3.2);
      const zebra = new THREE.Mesh(zebraGeo, stripeMat);
      zebra.position.set(x, 0.07, 49.5);
      scene.add(zebra);
    }

    // ==========================================
    // 4. GRAND ENTRANCE GATES & SECURITY CABIN
    // ==========================================
    const gateGroup = new THREE.Group();
    gateGroup.position.set(0, 0, 48);

    // Left Gate Pylon Pillar
    const pylonGeo = new THREE.BoxGeometry(2.4, 7, 2.4);
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.3, metalness: 0.1 });
    const pylonL = new THREE.Mesh(pylonGeo, pylonMat);
    pylonL.position.set(-6.5, 3.5, 0);
    pylonL.castShadow = true;
    gateGroup.add(pylonL);

    // Right Gate Pylon Pillar
    const pylonR = new THREE.Mesh(pylonGeo, pylonMat);
    pylonR.position.set(6.5, 3.5, 0);
    pylonR.castShadow = true;
    gateGroup.add(pylonR);

    // Modern Cantilever Gate Canopy Arch
    const canopyArchGeo = new THREE.BoxGeometry(16, 1.4, 3.6);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.2, metalness: 0.3 });
    const canopyArch = new THREE.Mesh(canopyArchGeo, canopyMat);
    canopyArch.position.set(0, 7.2, 0);
    canopyArch.castShadow = true;
    gateGroup.add(canopyArch);

    // Helper to render crisp procedural 2D signboard textures
    function createTextTexture(text: string, bgColor: string, textColor: string, width = 1024, height = 128) {
      const cvs = document.createElement("canvas");
      cvs.width = width;
      cvs.height = height;
      const ctx = cvs.getContext("2d");
      if (ctx) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);

        // Gold border trim
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 6;
        ctx.strokeRect(6, 6, width - 12, height - 12);

        // Subtle inner rim
        ctx.strokeStyle = "rgba(251, 191, 36, 0.4)";
        ctx.lineWidth = 2;
        ctx.strokeRect(12, 12, width - 24, height - 24);

        // Text
        ctx.fillStyle = textColor;
        const fontSize = Math.min(46, Math.max(20, Math.floor((width - 40) / ((text.length || 1) * 0.62))));
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text.toUpperCase(), width / 2, height / 2);
      }
      const tex = new THREE.CanvasTexture(cvs);
      tex.needsUpdate = true;
      return tex;
    }

    // Society Name Signboard on the Gate
    const gateSignTex = createTextTexture(societyName, "#0f2e22", "#fbbf24", 1024, 128);
    const signGeo = new THREE.BoxGeometry(14, 1.1, 0.25);
    const signMat = new THREE.MeshStandardMaterial({
      map: gateSignTex,
      roughness: 0.2,
      metalness: 0.4,
    });
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(0, 7.2, 1.85);
    gateGroup.add(sign);

    // Grand Society Rooftop Signboard atop the central structure
    const roofSignTex = createTextTexture(societyName, "#0f2e22", "#fbbf24", 1024, 128);
    const roofSignGeo = new THREE.BoxGeometry(18, 2.2, 0.35);
    const roofSignMat = new THREE.MeshStandardMaterial({
      map: roofSignTex,
      roughness: 0.2,
      metalness: 0.5,
    });
    const roofSign = new THREE.Mesh(roofSignGeo, roofSignMat);
    roofSign.position.set(0, maxOverallFloor * 3.4 + 4, 10);
    roofSign.castShadow = true;
    scene.add(roofSign);

    // Security Guard Cabin
    const cabinGeo = new THREE.BoxGeometry(3.5, 3.5, 4);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(8.8, 1.75, 0);
    cabin.castShadow = true;
    gateGroup.add(cabin);

    // Cabin Windows
    const cabinWinGeo = new THREE.BoxGeometry(2.4, 1.4, 0.1);
    const cabinWinMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.1,
      transparent: true,
      opacity: 0.7,
    });
    const cabinWin = new THREE.Mesh(cabinWinGeo, cabinWinMat);
    cabinWin.position.set(8.8, 2, 2.05);
    gateGroup.add(cabinWin);

    // Boom Barrier Pole (with red/white warning stripes)
    const barrierBaseGeo = new THREE.BoxGeometry(0.8, 1.2, 0.8);
    const barrierBaseMat = new THREE.MeshStandardMaterial({ color: 0xef4444 });
    const barrierBase = new THREE.Mesh(barrierBaseGeo, barrierBaseMat);
    barrierBase.position.set(5.1, 0.6, 0.5);
    gateGroup.add(barrierBase);

    const boomArmGeo = new THREE.BoxGeometry(9.6, 0.2, 0.2);
    const boomArmMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const boomArm = new THREE.Mesh(boomArmGeo, boomArmMat);
    boomArm.position.set(0, 1.1, 0.5);
    gateGroup.add(boomArm);

    scene.add(gateGroup);

    // ==========================================
    // 5. REALISTIC PROCEDURAL 3D TREES & FOLIAGE
    // ==========================================
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const foliageMatA = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.7 });
    const foliageMatB = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.7 });
    const foliageMatC = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.7 });

    // Helper: Create Lush Shade Tree
    function createLushTree(x: number, z: number, scale = 1.0) {
      const tree = new THREE.Group();
      tree.position.set(x, 0, z);
      tree.scale.set(scale, scale, scale);

      // Tree Trunk
      const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 4.2, 8);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 2.1;
      trunk.castShadow = true;
      tree.add(trunk);

      // Layered Round Canopies
      const mats = [foliageMatA, foliageMatB, foliageMatC];
      const offsets = [
        { y: 4.8, r: 2.4, mat: mats[0] },
        { y: 6.2, r: 2.0, mat: mats[1] },
        { y: 7.2, r: 1.5, mat: mats[2] },
      ];

      offsets.forEach((o) => {
        const canGeo = new THREE.DodecahedronGeometry(o.r, 1);
        const can = new THREE.Mesh(canGeo, o.mat);
        can.position.y = o.y;
        can.castShadow = true;
        can.receiveShadow = true;
        tree.add(can);
      });

      scene.add(tree);
    }

    // Helper: Create Royal Palm Tree
    function createPalmTree(x: number, z: number, scale = 1.0) {
      const palm = new THREE.Group();
      palm.position.set(x, 0, z);
      palm.scale.set(scale, scale, scale);

      // Slender ringed trunk
      const trunkGeo = new THREE.CylinderGeometry(0.22, 0.4, 7.5, 7);
      const palmTrunk = new THREE.Mesh(trunkGeo, trunkMat);
      palmTrunk.position.y = 3.75;
      palmTrunk.castShadow = true;
      palm.add(palmTrunk);

      // Radiating palm crown fronds
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2;
        const frondGeo = new THREE.ConeGeometry(1.6, 3.8, 5);
        const frond = new THREE.Mesh(frondGeo, foliageMatB);
        frond.position.set(Math.cos(angle) * 1.5, 7.4, Math.sin(angle) * 1.5);
        frond.rotation.z = Math.cos(angle) * 0.7;
        frond.rotation.x = Math.sin(angle) * 0.7;
        frond.castShadow = true;
        palm.add(frond);
      }

      scene.add(palm);
    }

    // Plant Palm Trees along the entrance avenue
    [-7, 7].forEach((px) => {
      for (let pz = 28; pz <= 46; pz += 6) {
        createPalmTree(px, pz, 0.95);
      }
    });

    // Plant Lush Trees around the courtyard and perimeter, safely clear of all building footprints
    const treePositions = [
      // Front lawn gardens
      { x: -28, z: 22, s: 1.1 },
      { x: 28, z: 22, s: 1.15 },
      // Corner lawn trees safely in front of both building corners (z = 10 is >10 units clear of the building facade)
      { x: -36, z: 10, s: 1.1 },
      { x: 36, z: 10, s: 1.1 },
      // Outer side perimeter trees (x = -46 and 46 are >10 units clear of outer building walls)
      { x: -46, z: -6, s: 1.15 },
      { x: 46, z: -6, s: 1.15 },
      // Central courtyard trees
      { x: -16, z: 24, s: 0.9 },
      { x: 16, z: 24, s: 0.9 },
      // Rear perimeter landscaping behind the towers
      { x: -28, z: -28, s: 1.1 },
      { x: 28, z: -28, s: 1.1 },
      { x: -14, z: -40, s: 1.0 },
      { x: 14, z: -40, s: 1.0 },
      // Gate entrance boulevard corners
      { x: -38, z: 36, s: 1.2 },
      { x: 38, z: 36, s: 1.2 },
    ];
    treePositions.forEach((tp) => createLushTree(tp.x, tp.z, tp.s));

    // Manicured flowering hedges & planter boxes
    [-18, 18].forEach((hx) => {
      const hedgeGeo = new THREE.BoxGeometry(2, 0.9, 14);
      const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 });
      const hedge = new THREE.Mesh(hedgeGeo, hedgeMat);
      hedge.position.set(hx, 0.8, -4);
      hedge.castShadow = true;
      scene.add(hedge);

      // Magenta Flower blossoms
      for (let fz = -10; fz <= 2; fz += 2.5) {
        const flowerGeo = new THREE.SphereGeometry(0.35, 6, 6);
        const flowerMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
        const flower = new THREE.Mesh(flowerGeo, flowerMat);
        flower.position.set(hx, 1.35, fz);
        scene.add(flower);
      }
    });

    // Modern Street Lamp Posts
    const streetLightPositions = [
      { x: -7.5, z: 32 },
      { x: 7.5, z: 32 },
      { x: -7.5, z: 44 },
      { x: 7.5, z: 44 },
      { x: -20, z: 12 },
      { x: 20, z: 12 },
    ];
    streetLightPositions.forEach((lp) => {
      const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 5.2, 8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(lp.x, 2.6, lp.z);
      pole.castShadow = true;
      scene.add(pole);

      const lampHeadGeo = new THREE.SphereGeometry(0.35, 8, 8);
      const lampHeadMat = new THREE.MeshStandardMaterial({
        color: 0xfffbeb,
        emissive: 0xfacc15,
        emissiveIntensity: 1.2,
      });
      const lampHead = new THREE.Mesh(lampHeadGeo, lampHeadMat);
      lampHead.position.set(lp.x, 5.2, lp.z);
      scene.add(lampHead);
    });

    // ==========================================
    // 6. REALISTIC DYNAMIC RESIDENTIAL TOWERS
    // ==========================================
    const activeWings = Array.from(
      new Set((members ?? []).filter((m) => m.active).map((m) => m.wing))
    ).sort();
    const wingsList = activeWings.length > 0 ? activeWings : ["A", "B", "C"];

    // Vibrant Architectural Color Palette for Wings
    const towerStyles = [
      {
        bodyColor: 0xfbfbfa, // Crisp Luxury White
        accentColor: 0xd97706, // Rich Warm Terracotta Amber
        roofColor: 0x1e293b, // Deep Charcoal Penthouse
        slabColor: 0xf1f5f9, // Light concrete floor slab
      },
      {
        bodyColor: 0xfdfaf5, // Mediterranean Warm Sand
        accentColor: 0xb45309, // Teak Wood Bronze
        roofColor: 0x334155, // Slate
        slabColor: 0xf1f5f9,
      },
      {
        bodyColor: 0xf8fafc, // Pearl White
        accentColor: 0x0284c7, // Aegean Sapphire
        roofColor: 0x0f172a,
        slabColor: 0xf1f5f9,
      },
      {
        bodyColor: 0xfefefe, // Clean Ivory
        accentColor: 0x059669, // Forest Jade
        roofColor: 0x1e293b,
        slabColor: 0xf1f5f9,
      },
    ];

    const towers = wingsList.map((wLetter, idx) => {
      let x = 0;
      let z = -10;
      if (wingsList.length === 1) {
        x = 0;
        z = -10;
      } else if (wingsList.length === 2) {
        x = idx === 0 ? -24 : 24;
        z = -10;
      } else if (wingsList.length === 3) {
        if (idx === 0) {
          x = -24;
          z = -8;
        } else if (idx === 1) {
          x = 24;
          z = -8;
        } else {
          x = 0;
          z = -28;
        }
      } else {
        const angle = (idx / wingsList.length) * Math.PI * 1.5 + Math.PI * 0.25;
        x = Math.cos(angle) * 30;
        z = -Math.sin(angle) * 20 - 8;
      }

      const wingMembers = (members ?? []).filter((m) => m.wing === wLetter && m.active);
      const floorGroups = new Map<number, Member[]>();
      let maxFlr = 1;

      for (const m of wingMembers) {
        const f = getFlatFloor(m.flat, m.floor);
        if (f > maxFlr) maxFlr = f;
        if (!floorGroups.has(f)) floorGroups.set(f, []);
        floorGroups.get(f)!.push(m);
      }
      if (wingMembers.length === 0) maxFlr = 4;

      const maxUnits = Math.max(1, ...Array.from(floorGroups.values()).map((arr) => arr.length));
      const style = towerStyles[idx % towerStyles.length];

      return {
        wingLetter: wLetter,
        name: `Wing ${wLetter}`,
        x,
        z,
        floors: Math.max(1, maxFlr),
        maxUnits,
        floorGroups,
        ...style,
      };
    });

    const interactiveWindows: any[] = [];

    // Interactive Window Materials with vibrant emissive glow
    const windowMatClear = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.7,
      roughness: 0.15,
      metalness: 0.2,
    });
    const windowMatDue = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.85,
      roughness: 0.15,
      metalness: 0.2,
    });
    const windowMatSelected = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity: 1.3,
      roughness: 0.1,
      metalness: 0.3,
    });
    const windowMatLit = new THREE.MeshStandardMaterial({
      color: 0xffedd5,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.45,
      roughness: 0.2,
    });

    towers.forEach((tw) => {
      const towerHeight = tw.floors * 3.4;
      const towerWidth = Math.max(15, tw.maxUnits * 4.6 + 4);
      const towerDepth = 14;

      // Main Architectural Tower Body
      const towerBodyGeo = new THREE.BoxGeometry(towerWidth, towerHeight, towerDepth);
      const towerMat = new THREE.MeshStandardMaterial({
        color: tw.bodyColor,
        roughness: 0.3,
        metalness: 0.05,
      });
      const towerMesh = new THREE.Mesh(towerBodyGeo, towerMat);
      towerMesh.position.set(tw.x, towerHeight / 2, tw.z);
      towerMesh.castShadow = true;
      towerMesh.receiveShadow = true;
      scene.add(towerMesh);

      // Vertical Accent Color Panels (Pylons)
      const accentGeo = new THREE.BoxGeometry(1.6, towerHeight, 0.4);
      const accentMat = new THREE.MeshStandardMaterial({
        color: tw.accentColor,
        roughness: 0.25,
        metalness: 0.15,
      });
      [-(towerWidth / 2 - 1.2), towerWidth / 2 - 1.2].forEach((ax) => {
        const accentPylon = new THREE.Mesh(accentGeo, accentMat);
        accentPylon.position.set(tw.x + ax, towerHeight / 2, tw.z + towerDepth / 2 + 0.1);
        accentPylon.castShadow = true;
        scene.add(accentPylon);
      });

      // Rooftop Penthouse Structure
      const roofGeo = new THREE.BoxGeometry(towerWidth * 0.72, 3.2, towerDepth * 0.75);
      const roofMat = new THREE.MeshStandardMaterial({
        color: tw.roofColor,
        roughness: 0.2,
        metalness: 0.3,
      });
      const roofMesh = new THREE.Mesh(roofGeo, roofMat);
      roofMesh.position.set(tw.x, towerHeight + 1.6, tw.z);
      roofMesh.castShadow = true;
      scene.add(roofMesh);

      // Rooftop Water Storage Tanks (Silver Cylinders)
      [-3.5, 3.5].forEach((tx) => {
        const tankGeo = new THREE.CylinderGeometry(1.2, 1.2, 2.4, 16);
        const tankMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.2 });
        const tank = new THREE.Mesh(tankGeo, tankMat);
        tank.position.set(tw.x + tx, towerHeight + 4.2, tw.z - 2);
        tank.castShadow = true;
        scene.add(tank);
      });

      // Rooftop Solar Panel Arrays (Tilted at 30 deg towards the sun)
      const solarGeo = new THREE.BoxGeometry(4.5, 0.15, 2.5);
      const solarMat = new THREE.MeshStandardMaterial({
        color: 0x1e3a8a,
        metalness: 0.8,
        roughness: 0.1,
      });
      const solar = new THREE.Mesh(solarGeo, solarMat);
      solar.position.set(tw.x, towerHeight + 3.8, tw.z + 2.5);
      solar.rotation.x = -Math.PI / 6;
      solar.castShadow = true;
      scene.add(solar);

      // Building Wing Letter Signboard at top
      const badgeGeo = new THREE.BoxGeometry(4, 1.4, 0.2);
      const badgeMat = new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xd97706,
        emissiveIntensity: 0.5,
      });
      const badge = new THREE.Mesh(badgeGeo, badgeMat);
      badge.position.set(tw.x, towerHeight + 2.4, tw.z + towerDepth * 0.75 / 2 + 0.15);
      scene.add(badge);

      // Horizontal Floor Slabs & Windows for each floor
      for (let f = 1; f <= tw.floors; f++) {
        const slabY = (f - 1) * 3.4;
        const yPos = f * 3.4 - 1.2;

        // Concrete Floor Slab Divider
        const slabGeo = new THREE.BoxGeometry(towerWidth + 0.6, 0.4, towerDepth + 0.6);
        const slabMat = new THREE.MeshStandardMaterial({ color: tw.slabColor, roughness: 0.5 });
        const slab = new THREE.Mesh(slabGeo, slabMat);
        slab.position.set(tw.x, slabY, tw.z);
        slab.receiveShadow = true;
        scene.add(slab);

        const flatsOnFloor = tw.floorGroups.get(f) || [];

        if (flatsOnFloor.length > 0) {
          flatsOnFloor.sort((a, b) => a.flat.localeCompare(b.flat, "en", { numeric: true }));
          const count = flatsOnFloor.length;
          const spacing = towerWidth / (count + 1);

          flatsOnFloor.forEach((m, idx) => {
            const wx = -towerWidth / 2 + spacing * (idx + 1);
            const hasDues = m.dueBalance > 0;
            const isCurrentSelected = tw.wingLetter === selectedWing && m.flat === selectedFlat;

            // Architectural Window Frame
            const frameGeo = new THREE.BoxGeometry(2.6, 2.0, 0.2);
            const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 });
            const frame = new THREE.Mesh(frameGeo, frameMat);
            frame.position.set(tw.x + wx, yPos, tw.z + towerDepth / 2 + 0.05);
            scene.add(frame);

            // Interactive Glass Window Pane
            const winGeo = new THREE.BoxGeometry(2.3, 1.7, 0.3);
            const mat = isCurrentSelected ? windowMatSelected : hasDues ? windowMatDue : windowMatClear;
            const winMesh = new THREE.Mesh(winGeo, mat);
            winMesh.position.set(tw.x + wx, yPos, tw.z + towerDepth / 2 + 0.15);

            winMesh.userData = {
              flat: m.flat,
              wing: tw.wingLetter,
              floor: f,
              isDue: hasDues,
              owner: m.ownerName || "Resident Member",
              due: m.dueBalance || 0,
            };

            interactiveWindows.push(winMesh);
            scene.add(winMesh);

            // Modern Balcony with Tinted Glass Railing
            const balcBaseGeo = new THREE.BoxGeometry(2.8, 0.25, 1.2);
            const balcBaseMat = new THREE.MeshStandardMaterial({ color: tw.slabColor, roughness: 0.4 });
            const balcBase = new THREE.Mesh(balcBaseGeo, balcBaseMat);
            balcBase.position.set(tw.x + wx, yPos - 1.0, tw.z + towerDepth / 2 + 0.65);
            balcBase.castShadow = true;
            balcBase.receiveShadow = true;
            scene.add(balcBase);

            const glassRailGeo = new THREE.BoxGeometry(2.8, 0.8, 0.1);
            const glassRailMat = new THREE.MeshStandardMaterial({
              color: 0x38bdf8,
              roughness: 0.1,
              metalness: 0.2,
              transparent: true,
              opacity: 0.65,
            });
            const glassRail = new THREE.Mesh(glassRailGeo, glassRailMat);
            glassRail.position.set(tw.x + wx, yPos - 0.55, tw.z + towerDepth / 2 + 1.2);
            scene.add(glassRail);

            // Top Handrail
            const railGeo = new THREE.BoxGeometry(2.9, 0.08, 0.12);
            const railMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8 });
            const rail = new THREE.Mesh(railGeo, railMat);
            rail.position.set(tw.x + wx, yPos - 0.12, tw.z + towerDepth / 2 + 1.2);
            scene.add(rail);
          });
        } else {
          // Placeholder windows for empty floor
          [-3, 3].forEach((wx) => {
            const winGeo = new THREE.BoxGeometry(2.3, 1.7, 0.3);
            const winMesh = new THREE.Mesh(winGeo, windowMatLit);
            winMesh.position.set(tw.x + wx, yPos, tw.z + towerDepth / 2 + 0.15);
            scene.add(winMesh);
          });
        }
      }

      // Parapet Wall at Top Roof Edge
      const parapetGeo = new THREE.BoxGeometry(towerWidth + 0.4, 0.8, towerDepth + 0.4);
      const parapetMat = new THREE.MeshStandardMaterial({ color: tw.bodyColor, roughness: 0.4 });
      const parapet = new THREE.Mesh(parapetGeo, parapetMat);
      parapet.position.set(tw.x, towerHeight + 0.4, tw.z);
      scene.add(parapet);
    });

    // ==========================================
    // 7. SIMULATED VEHICLES ON THE ROADS
    // ==========================================
    const vehicleColors = [0xef4444, 0x2563eb, 0xffffff, 0xf59e0b, 0x10b981];
    const vehicles: any[] = [];
    for (let i = 0; i < 5; i++) {
      const carGroup = new THREE.Group();
      const bodyGeo = new THREE.BoxGeometry(2.6, 0.9, 1.4);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: vehicleColors[i % vehicleColors.length],
        metalness: 0.5,
        roughness: 0.2,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.6;
      body.castShadow = true;
      carGroup.add(body);

      const cabinGeo = new THREE.BoxGeometry(1.5, 0.68, 1.2);
      const cabinMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1 });
      const cabin = new THREE.Mesh(cabinGeo, cabinMat);
      cabin.position.set(-0.2, 1.2, 0);
      carGroup.add(cabin);

      // Headlights
      const headLGeo = new THREE.SphereGeometry(0.12, 6, 6);
      const headLMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
      const headL1 = new THREE.Mesh(headLGeo, headLMat);
      headL1.position.set(1.3, 0.6, 0.45);
      const headL2 = new THREE.Mesh(headLGeo, headLMat);
      headL2.position.set(1.3, 0.6, -0.45);
      carGroup.add(headL1);
      carGroup.add(headL2);

      scene.add(carGroup);
      vehicles.push({
        mesh: carGroup,
        progress: i / 5,
        speed: 0.0007 + i * 0.00015,
      });
    }

    function updateVehicles() {
      const totalLength = 88 + 94 + 88 + 94;
      vehicles.forEach((v) => {
        v.progress = (v.progress + v.speed) % 1.0;
        const currentDist = v.progress * totalLength;
        if (currentDist < 88) {
          const t = currentDist / 88;
          v.mesh.position.set(-44 + 88 * t, 0, 52);
          v.mesh.rotation.y = 0;
        } else if (currentDist < 182) {
          const t = (currentDist - 88) / 94;
          v.mesh.position.set(44, 0, 52 - 94 * t);
          v.mesh.rotation.y = Math.PI / 2;
        } else if (currentDist < 270) {
          const t = (currentDist - 182) / 88;
          v.mesh.position.set(44 - 88 * t, 0, -42);
          v.mesh.rotation.y = Math.PI;
        } else {
          const t = (currentDist - 270) / 94;
          v.mesh.position.set(-44, 0, -42 + 94 * t);
          v.mesh.rotation.y = -Math.PI / 2;
        }
      });
    }

    // ==========================================
    // 8. RAYCASTER & INTERACTION (CLICK/HOVER)
    // ==========================================
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(interactiveWindows);

      if (intersects.length > 0) {
        const target = intersects[0].object;
        if (target.userData && target.userData.flat) {
          interactiveWindows.forEach((w) => {
            w.material = w.userData.isDue ? windowMatDue : windowMatClear;
          });
          target.material = windowMatSelected;

          if (onSelectUnit) {
            onSelectUnit(target.userData.wing, target.userData.flat);
          }
        }
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(interactiveWindows);

      if (intersects.length > 0) {
        const target = intersects[0].object;
        setHoveredInfo({
          unit: `${target.userData.wing}-${target.userData.flat}`,
          owner: target.userData.owner,
          due: target.userData.due,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      } else {
        setHoveredInfo(null);
      }
    };

    container.addEventListener("click", handleClick);
    container.addEventListener("mousemove", handleMouseMove);

    // Orbit Dragging
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let targetRotationY = 0;
    let currentRotationY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    const handleDragMove = (e: MouseEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - previousMousePosition.x;
        targetRotationY += deltaX * 0.005;
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    };

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mousemove", handleDragMove);

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 500;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // Animation Loop
    let animId: number = 0;
    function animate() {
      animId = requestAnimationFrame(animate);
      currentRotationY += (targetRotationY - currentRotationY) * 0.05;
      scene.rotation.y = currentRotationY;
      if (!isDragging) {
        targetRotationY += 0.0005;
      }
      updateVehicles();
      renderer.render(scene, camera);
    }
    animate();

    sceneRefs.current = {
      renderer,
      camera,
      scene,
      interactiveWindows,
      sunLight,
      ambientLight,
      resetOrbit: () => {
        targetRotationY = 0;
        camera.position.set(52, 38, 58);
        camera.lookAt(0, 10, 0);
      },
      setCameraElevation: (floor: number) => {
        camera.position.y = 14 + floor * 3.4;
        camera.lookAt(0, floor * 2.2, 0);
      },
      animId,
    };

    return () => {
      cancelAnimationFrame(animId);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mousemove", handleDragMove);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
    };
  }, [members]);

  // Update window highlight when selectedUnit changes externally
  useEffect(() => {
    const windows = sceneRefs.current.interactiveWindows;
    if (!windows || typeof window === "undefined" || !(window as any).THREE) return;
    const THREE = (window as any).THREE;

    const windowMatClear = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.7,
      roughness: 0.15,
    });
    const windowMatDue = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.85,
      roughness: 0.15,
    });
    const windowMatSelected = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity: 1.3,
      roughness: 0.1,
    });

    windows.forEach((w) => {
      if (w.userData.wing === selectedWing && w.userData.flat === selectedFlat) {
        w.material = windowMatSelected;
      } else {
        w.material = w.userData.isDue ? windowMatDue : windowMatClear;
      }
    });
  }, [selectedWing, selectedFlat]);

  // Handle Dusk / Daylight Switcher
  const toggleDusk = () => {
    const next = !duskMode;
    setDuskMode(next);
    const { scene, sunLight, ambientLight } = sceneRefs.current;
    if (!scene || typeof window === "undefined" || !(window as any).THREE) return;
    const THREE = (window as any).THREE;

    if (next) {
      // Golden Hour Sunset
      scene.background = new THREE.Color(0xfdba74);
      scene.fog = new THREE.FogExp2(0xfed7aa, 0.006);
      if (sunLight) {
        sunLight.color.setHex(0xf97316);
        sunLight.intensity = 1.8;
      }
      if (ambientLight) {
        ambientLight.color.setHex(0xfde047);
        ambientLight.intensity = 0.9;
      }
    } else {
      // Vibrant Crisp Daylight
      scene.background = new THREE.Color(0x9ed3ff);
      scene.fog = new THREE.FogExp2(0xd0e8ff, 0.005);
      if (sunLight) {
        sunLight.color.setHex(0xfffaea);
        sunLight.intensity = 2.3;
      }
      if (ambientLight) {
        ambientLight.color.setHex(0xbae6fd);
        ambientLight.intensity = 1.2;
      }
    }
  };

  const handleElevationChange = (flr: number) => {
    setFloorElevation(flr);
    sceneRefs.current.setCameraElevation?.(flr);
  };

  return (
    <div className="relative w-full h-[440px] sm:h-[500px] rounded-3xl overflow-hidden shadow-xl border border-line bg-gradient-to-b from-sky-200 to-sky-100 select-none">
      {/* Three.js Canvas Container */}
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Floating Hover Tooltip */}
      {hoveredInfo && (
        <div
          className="absolute z-30 pointer-events-none p-3 rounded-xl bg-surface/95 backdrop-blur-md shadow-xl border border-line text-on-surface transform -translate-x-1/2 -translate-y-full mb-3 flex flex-col gap-1 transition-all"
          style={{ left: `${hoveredInfo.x}px`, top: `${hoveredInfo.y}px` }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-code-md text-title-md font-bold text-primary">
              Flat {hoveredInfo.unit}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                hoveredInfo.due > 0 ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
              }`}
            >
              {hoveredInfo.due > 0 ? `₹${hoveredInfo.due} Due` : "Settled (Clear)"}
            </span>
          </div>
          <span className="font-body-sm text-[12px] text-ink-soft">
            Owner: <strong>{hoveredInfo.owner}</strong>
          </span>
          <span className="font-label-sm text-[10px] text-primary mt-0.5">
            Click window to select for payment &rarr;
          </span>
        </div>
      )}

      {/* Top Left Status & Environment HUD */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2 max-w-[280px] sm:max-w-md">
        <div className="px-3.5 py-1.5 rounded-xl bg-surface/90 backdrop-blur-md shadow-md border border-line/80 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-success animate-pulse shrink-0" />
          <span className="font-title-md text-[13px] font-bold text-on-surface truncate" title={societyName}>
            {societyName}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-gold-soft text-primary font-code-md text-[10px] font-bold uppercase shrink-0">
            3D View
          </span>
        </div>

        {/* Legend */}
        <div className="px-3 py-1.5 rounded-xl bg-surface/85 backdrop-blur-md shadow-sm border border-line/60 flex items-center gap-3 font-code-md text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-success shadow-sm" />
            <span className="text-ink-soft">Clear</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-error shadow-sm" />
            <span className="text-ink-soft">Dues</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm" />
            <span className="text-primary font-bold">Selected</span>
          </div>
        </div>
      </div>

      {/* Top Right Controls: Daylight/Dusk & Camera Reset */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleDusk}
          className="p-2 rounded-xl bg-surface/90 backdrop-blur-md shadow-md border border-line hover:bg-gold-soft text-primary transition-all cursor-pointer flex items-center gap-1.5 px-3"
          title={duskMode ? "Switch to Bright Daylight" : "Switch to Golden Hour Sunset"}
        >
          <span className="material-symbols-outlined text-[18px]">
            {duskMode ? "wb_sunny" : "wb_twilight"}
          </span>
          <span className="font-label-md text-[12px] font-bold">
            {duskMode ? "Daylight" : "Golden Hour"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => sceneRefs.current.resetOrbit?.()}
          className="p-2 rounded-xl bg-surface/90 backdrop-blur-md shadow-md border border-line hover:bg-gold-soft text-on-surface transition-all cursor-pointer"
          title="Reset Camera Angle"
        >
          <span className="material-symbols-outlined text-[18px]">videocam</span>
        </button>
      </div>

      {/* Bottom Floor Elevation Slider */}
      <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-between gap-4 p-3 rounded-2xl bg-surface/90 backdrop-blur-md shadow-lg border border-line/80">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">apartment</span>
          <span className="font-label-md text-[12px] font-bold text-on-surface whitespace-nowrap">
            Floor Focus: {floorElevation === 0 ? "Ground Level" : `Floor ${floorElevation}`}
          </span>
        </div>

        <input
          type="range"
          min="0"
          max={maxOverallFloor}
          value={floorElevation}
          onChange={(e) => handleElevationChange(Number(e.target.value))}
          className="w-full max-w-xs accent-primary cursor-pointer"
        />

        <span className="font-code-md text-[11px] text-ink-soft whitespace-nowrap hidden sm:inline">
          Drag to rotate &bull; Scroll to zoom
        </span>
      </div>
    </div>
  );
}
