// The lantern as a custom object (@kits/three): an iron post and cap, emissive glass, and a real PointLight that lights
// the floor, the walls and the character. `shadowed` lanterns also cast point-light shadows.
import {customObject, THREE} from '@kits/three';

const IRON = 0x1c1f26,
  WARM = 0xffb04a;

const make = (shadowed: boolean) =>
  customObject({
    id: shadowed ? 'lantern-shadowed' : 'lantern',
    limits: {triangles: 2_000, textures: 0},
    create({own}) {
      const lantern = new THREE.Group();
      const iron = own(new THREE.MeshStandardMaterial({color: IRON, metalness: 0.8, roughness: 0.4}));
      const post = new THREE.Mesh(own(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 12)), iron);
      post.position.y = 1.1;
      const cap = new THREE.Mesh(own(new THREE.ConeGeometry(0.3, 0.3, 12)), iron);
      cap.position.y = 2.8;
      const glass = new THREE.Mesh(
        own(new THREE.BoxGeometry(0.42, 0.5, 0.42)),
        own(new THREE.MeshStandardMaterial({color: 0xffd28a, emissive: WARM, emissiveIntensity: 6, roughness: 0.2})),
      );
      glass.position.y = 2.45;
      glass.name = 'glass';
      const light = new THREE.PointLight(0xffa850, 7, 9, 1.7);
      light.position.y = 2.3;
      if (shadowed) {
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        light.shadow.bias = -0.004;
        light.shadow.camera.near = 0.2;
      }
      post.castShadow = cap.castShadow = true;
      lantern.add(post, cap, glass, light);
      return lantern;
    },
  });

export const lantern = make(false);
export const shadowedLantern = make(true);
