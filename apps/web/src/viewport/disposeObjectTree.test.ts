import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeObjectTree } from "./disposeObjectTree";

describe("disposeObjectTree", () => {
  it("descarta recursos compartilhados uma única vez", () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");

    root.add(
      new THREE.Mesh(geometry, material),
      new THREE.Mesh(geometry, material),
    );

    disposeObjectTree(root);

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });

  it("descarta todos os materiais de uma malha", () => {
    const firstMaterial = new THREE.MeshBasicMaterial();
    const secondMaterial = new THREE.MeshStandardMaterial();
    const firstDispose = vi.spyOn(firstMaterial, "dispose");
    const secondDispose = vi.spyOn(secondMaterial, "dispose");
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      [firstMaterial, secondMaterial],
    );

    disposeObjectTree(mesh);

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
  });
});
