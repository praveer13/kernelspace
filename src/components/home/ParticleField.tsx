import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const COUNT = 600
const MINT = new THREE.Color('#3EF2A4')
const CYAN = new THREE.Color('#22D3EE')

/**
 * "Tokens in flight" — ~600 dim mint/cyan points drifting slowly in 3D
 * orthographic space with subtle pointer parallax (lerp 0.04). Rendered at
 * 0.6 opacity, desaturated: texture, not spectacle (home.md §1).
 */
function Points() {
  const groupRef = useRef<THREE.Group>(null)
  const pointsRef = useRef<THREE.Points>(null)
  const pointer = useRef({ x: 0, y: 0 })

  const { positions, colors, speeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    const colors = new Float32Array(COUNT * 3)
    const speeds = new Float32Array(COUNT)
    const spreadX = typeof window !== 'undefined' ? window.innerWidth : 1440
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spreadX * 1.2
      positions[i * 3 + 1] = (Math.random() - 0.5) * 900
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80
      const c = Math.random() < 0.6 ? MINT : CYAN
      // desaturate: pull toward grey
      const grey = 0.35
      colors[i * 3] = c.r * (1 - grey) + grey * 0.4
      colors[i * 3 + 1] = c.g * (1 - grey) + grey * 0.4
      colors[i * 3 + 2] = c.b * (1 - grey) + grey * 0.4
      speeds[i] = 4 + Math.random() * 10
    }
    return { positions, colors, speeds }
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((state, delta) => {
    const group = groupRef.current
    const points = pointsRef.current
    if (!group || !points) return
    const t = state.clock.elapsedTime

    // slow drift upward, wrap
    const pos = points.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const dt = Math.min(delta, 0.05)
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] += speeds[i] * dt
      if (arr[i * 3 + 1] > 460) arr[i * 3 + 1] = -460
    }
    pos.needsUpdate = true

    // gentle whole-field sway + pointer parallax (lerp 0.04)
    group.rotation.z = Math.sin(t * 0.05) * 0.02
    group.position.x += (pointer.current.x * 24 - group.position.x) * 0.04
    group.position.y += (-pointer.current.y * 16 - group.position.y) * 0.04
  })

  return (
    <group ref={groupRef}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={2}
          sizeAttenuation={false}
          vertexColors
          transparent
          opacity={0.6}
          depthWrite={false}
        />
      </points>
    </group>
  )
}

export default function ParticleField() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [fadeIn, setFadeIn] = useState(false)

  // Pause render loop when offscreen (react-dev.md).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0,
    })
    io.observe(el)
    const t = window.setTimeout(() => setFadeIn(true), 100)
    return () => {
      io.disconnect()
      window.clearTimeout(t)
    }
  }, [])

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className="absolute inset-0"
      style={{ opacity: fadeIn ? 1 : 0, transition: 'opacity 1200ms ease' }}
    >
      <Canvas
        orthographic
        camera={{ zoom: 1, position: [0, 0, 100], near: 1, far: 300 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
        frameloop={visible ? 'always' : 'never'}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Points />
      </Canvas>
    </div>
  )
}
