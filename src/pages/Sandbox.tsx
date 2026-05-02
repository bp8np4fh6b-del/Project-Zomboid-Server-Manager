import { useState, useEffect, useMemo } from 'react'
import { Save, FileText, Skull, Package, Cloud, Car, Home, Activity, RotateCcw } from 'lucide-react'

// ────────────────────────────────────────────────────────────────────────
// Field schema for PZ Build 42 sandbox vars.
// Each entry: key, label, type, options (for dropdowns), group, help.
// Most numeric PZ "scale" vars use 1 = highest/most, higher = less. The
// labels describe what the value means in PZ terms so users don't need
// to memorize the integer→meaning mapping.
// ────────────────────────────────────────────────────────────────────────

type FieldType = 'select' | 'number' | 'float' | 'bool' | 'text'

interface Field {
  key: string
  label: string
  type: FieldType
  options?: { value: string; label: string }[]
  help?: string
}

const SCALE_LO_HI = (lo: string, hi: string) => [
  { value: '1', label: `Insane (${lo})` },
  { value: '2', label: `High` },
  { value: '3', label: `Normal` },
  { value: '4', label: `Low` },
  { value: '5', label: `None (${hi})` },
]

const FREQ = [
  { value: '1', label: 'Extremely Rare' },
  { value: '2', label: 'Rare' },
  { value: '3', label: 'Sometimes' },
  { value: '4', label: 'Often' },
  { value: '5', label: 'Very Often' },
  { value: '6', label: 'Insane' },
  { value: '7', label: 'Apocalypse' },
]

const ZOMBIE_POP = [
  { value: '1', label: 'Insane' },
  { value: '2', label: 'High' },
  { value: '3', label: 'Normal' },
  { value: '4', label: 'Low' },
  { value: '5', label: 'None' },
]

const ZOMBIE_SPEED = [
  { value: '1', label: 'Sprinters' },
  { value: '2', label: 'Fast Shamblers' },
  { value: '3', label: 'Shamblers' },
]

const ZOMBIE_STRENGTH = [
  { value: '1', label: 'Superhuman' },
  { value: '2', label: 'Normal' },
  { value: '3', label: 'Weak' },
]

const TRANSMISSION = [
  { value: '1', label: 'Blood + Saliva' },
  { value: '2', label: 'Saliva Only' },
  { value: '3', label: 'Everyone\'s Infected' },
  { value: '4', label: 'No Transmission' },
]

const REANIMATE = [
  { value: '1', label: 'Instantly' },
  { value: '2', label: '0–30 seconds' },
  { value: '3', label: '0–1 minutes' },
  { value: '4', label: '0–12 hours' },
  { value: '5', label: '2–3 days' },
  { value: '6', label: '1–2 weeks' },
]

const PEAK_TIME = [
  { value: '1', label: 'Day 7' },
  { value: '2', label: 'Day 28' },
  { value: '3', label: 'Day 60 (default)' },
  { value: '4', label: 'Day 90' },
  { value: '5', label: 'Day 180' },
  { value: '6', label: 'Day 365' },
]

const SHUTOFF = [
  { value: '1', label: 'Instantly' },
  { value: '2', label: '0–30 days' },
  { value: '3', label: '0–2 months' },
  { value: '4', label: '0–6 months' },
  { value: '5', label: '0–1 year' },
  { value: '6', label: '0–5 years' },
  { value: '7', label: '2–6 months' },
  { value: '8', label: '6 months – 1 year' },
  { value: '9', label: '1–2 years' },
]

const fieldGroups: { id: string; label: string; icon: any; fields: Field[] }[] = [
  {
    id: 'population',
    label: 'Zombie Population',
    icon: Skull,
    fields: [
      { key: 'Zombies', label: 'Population Multiplier', type: 'select', options: ZOMBIE_POP, help: 'Overall zombie density' },
      { key: 'ZombieConfig.PopulationMultiplier', label: 'Population Multiplier (fine)', type: 'float', help: 'Defaults to 1.0' },
      { key: 'ZombieConfig.PopulationStartMultiplier', label: 'Start Population', type: 'float' },
      { key: 'ZombieConfig.PopulationPeakMultiplier', label: 'Peak Population Multiplier', type: 'float' },
      { key: 'ZombieConfig.PopulationPeakDay', label: 'Peak Day', type: 'number' },
      { key: 'ZombieConfig.RespawnHours', label: 'Respawn Hours', type: 'float' },
      { key: 'ZombieConfig.RespawnUnseenHours', label: 'Respawn Unseen Hours', type: 'float' },
      { key: 'ZombieConfig.RespawnMultiplier', label: 'Respawn Multiplier', type: 'float' },
      { key: 'ZombieConfig.RedistributeHours', label: 'Redistribute Hours', type: 'float' },
      { key: 'Distribution', label: 'Distribution', type: 'select', options: [
        { value: '1', label: 'Urban Focused' },
        { value: '2', label: 'Uniform' },
      ]},
    ],
  },
  {
    id: 'zombies',
    label: 'Zombie Behaviour',
    icon: Skull,
    fields: [
      { key: 'ZombieLore.Speed', label: 'Speed', type: 'select', options: ZOMBIE_SPEED },
      { key: 'ZombieLore.Strength', label: 'Strength', type: 'select', options: ZOMBIE_STRENGTH },
      { key: 'ZombieLore.Toughness', label: 'Toughness', type: 'select', options: [
        { value: '1', label: 'Tough' }, { value: '2', label: 'Normal' }, { value: '3', label: 'Fragile' },
      ]},
      { key: 'ZombieLore.Transmission', label: 'Transmission', type: 'select', options: TRANSMISSION },
      { key: 'ZombieLore.Mortality', label: 'Infection Mortality', type: 'select', options: [
        { value: '1', label: 'Instant' }, { value: '2', label: '0–30 sec' },
        { value: '3', label: '0–1 min' }, { value: '4', label: '0–12 hr' },
        { value: '5', label: '2–3 days' }, { value: '6', label: '1–2 weeks' },
        { value: '7', label: 'Never' },
      ]},
      { key: 'ZombieLore.Reanimate', label: 'Reanimation Time', type: 'select', options: REANIMATE },
      { key: 'ZombieLore.Cognition', label: 'Cognition', type: 'select', options: [
        { value: '1', label: 'Navigate + Use Doors' }, { value: '2', label: 'Navigate' }, { value: '3', label: 'Basic Navigation' },
      ]},
      { key: 'ZombieLore.Memory', label: 'Memory', type: 'select', options: [
        { value: '1', label: 'Long' }, { value: '2', label: 'Normal' }, { value: '3', label: 'Short' }, { value: '4', label: 'None' },
      ]},
      { key: 'ZombieLore.Sight', label: 'Sight', type: 'select', options: [
        { value: '1', label: 'Eagle' }, { value: '2', label: 'Normal' }, { value: '3', label: 'Poor' },
      ]},
      { key: 'ZombieLore.Hearing', label: 'Hearing', type: 'select', options: [
        { value: '1', label: 'Pinpoint' }, { value: '2', label: 'Normal' }, { value: '3', label: 'Poor' },
      ]},
      { key: 'ZombieLore.ThumpNoChasing', label: 'Thump Without Chase Target', type: 'bool' },
      { key: 'ZombieLore.ThumpOnConstruction', label: 'Thump on Player Construction', type: 'bool' },
      { key: 'ZombieLore.ActiveOnly', label: 'Activity', type: 'select', options: [
        { value: '1', label: 'Both Day + Night' }, { value: '2', label: 'Night Only' }, { value: '3', label: 'Day Only' },
      ]},
      { key: 'ZombieLore.TriggerHouseAlarm', label: 'Can Trigger House Alarms', type: 'bool' },
      { key: 'ZombieLore.ZombiesDragDown', label: 'Drag Players Down', type: 'bool' },
      { key: 'ZombieLore.ZombiesFenceLunge', label: 'Lunge Over Fences', type: 'bool' },
      { key: 'ZombieLore.CrawlUnderVehicle', label: 'Crawl Under Vehicle', type: 'select', options: [
        { value: '1', label: 'Often' }, { value: '2', label: 'Sometimes' },
        { value: '3', label: 'Rarely' }, { value: '4', label: 'Never' },
      ]},
      { key: 'ZombieAttractionMultiplier', label: 'Sound Attraction Multiplier', type: 'float' },
    ],
  },
  {
    id: 'world',
    label: 'World & Time',
    icon: Cloud,
    fields: [
      { key: 'TimeSinceApocalypse', label: 'Time Since Apocalypse (peak)', type: 'select', options: PEAK_TIME },
      { key: 'StartYear', label: 'Start Year', type: 'number' },
      { key: 'StartMonth', label: 'Start Month (1-12)', type: 'number' },
      { key: 'StartDay', label: 'Start Day', type: 'number' },
      { key: 'StartTime', label: 'Start Time', type: 'select', options: [
        { value: '1', label: '7 AM' }, { value: '2', label: '9 AM' }, { value: '3', label: '12 PM' },
        { value: '4', label: '5 PM' }, { value: '5', label: '9 PM' }, { value: '6', label: 'Midnight' },
      ]},
      { key: 'DayLength', label: 'Day Length', type: 'select', options: [
        { value: '1', label: '15 min' }, { value: '2', label: '30 min' }, { value: '3', label: '1 hour' },
        { value: '4', label: '2 hours' }, { value: '5', label: '3 hours' }, { value: '6', label: '4 hours' },
        { value: '7', label: '5 hours' }, { value: '8', label: 'Real-time (24h)' },
      ]},
      { key: 'WaterShut', label: 'Water Shutoff', type: 'select', options: SHUTOFF },
      { key: 'WaterShutModifier', label: 'Water Shutoff Days', type: 'number' },
      { key: 'ElecShut', label: 'Electricity Shutoff', type: 'select', options: SHUTOFF },
      { key: 'ElecShutModifier', label: 'Electricity Shutoff Days', type: 'number' },
      { key: 'Temperature', label: 'Temperature', type: 'select', options: [
        { value: '1', label: 'Very Cold' }, { value: '2', label: 'Cold' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'Hot' }, { value: '5', label: 'Very Hot' },
      ]},
      { key: 'Rain', label: 'Rain', type: 'select', options: [
        { value: '1', label: 'Very Dry' }, { value: '2', label: 'Dry' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'Rainy' }, { value: '5', label: 'Very Rainy' },
      ]},
      { key: 'NightDarkness', label: 'Night Darkness', type: 'select', options: [
        { value: '1', label: 'Pitch Black' }, { value: '2', label: 'Dark' }, { value: '3', label: 'Normal' },
      ]},
      { key: 'NightLength', label: 'Night Length', type: 'number' },
      { key: 'GeneratorSpawning', label: 'Generator Spawn Rate', type: 'select', options: SCALE_LO_HI('Many', 'None') },
      { key: 'GeneratorFuelConsumption', label: 'Generator Fuel Consumption', type: 'float' },
      { key: 'PlaneCrashFrequency', label: 'Plane Crash Frequency (days)', type: 'number' },
    ],
  },
  {
    id: 'loot',
    label: 'Loot & Items',
    icon: Package,
    fields: [
      { key: 'FoodLoot', label: 'Food Loot', type: 'select', options: FREQ },
      { key: 'WeaponLoot', label: 'Weapon Loot', type: 'select', options: FREQ },
      { key: 'OtherLoot', label: 'Other Loot', type: 'select', options: FREQ },
      { key: 'LootRespawn', label: 'Loot Respawn', type: 'select', options: [
        { value: '1', label: 'None' }, { value: '2', label: 'Every Day' },
        { value: '3', label: 'Every Week' }, { value: '4', label: 'Every Month' },
      ]},
      { key: 'SeenHoursPreventLootRespawn', label: 'Hours Seen Prevents Respawn', type: 'number' },
      { key: 'HoursForWorldItemRemoval', label: 'Hours Before Items Decay', type: 'float' },
      { key: 'WorldItemRemovalList', label: 'Item Decay Allowlist', type: 'text' },
      { key: 'StarterKit', label: 'Starter Kit', type: 'bool' },
      { key: 'Nutrition', label: 'Nutrition System', type: 'bool' },
      { key: 'FoodRotSpeed', label: 'Food Spoilage Speed', type: 'select', options: [
        { value: '1', label: 'Very Fast' }, { value: '2', label: 'Fast' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'Slow' }, { value: '5', label: 'Very Slow' },
      ]},
      { key: 'FridgeFactor', label: 'Refrigeration Effectiveness', type: 'select', options: [
        { value: '1', label: 'Very Low' }, { value: '2', label: 'Low' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'High' }, { value: '5', label: 'Very High' },
      ]},
      { key: 'AnnotatedMapChance', label: 'Annotated Map Chance', type: 'select', options: [
        { value: '1', label: 'None' }, { value: '2', label: 'Extremely Rare' },
        { value: '3', label: 'Rare' }, { value: '4', label: 'Sometimes' },
        { value: '5', label: 'Often' }, { value: '6', label: 'Very Often' },
      ]},
    ],
  },
  {
    id: 'survival',
    label: 'Survival',
    icon: Activity,
    fields: [
      { key: 'XpMultiplier', label: 'XP Multiplier', type: 'float' },
      { key: 'XpMultiplierAffectsPassive', label: 'XP Affects Passive Skills', type: 'bool' },
      { key: 'StatsDecrease', label: 'Stats Decrease Speed', type: 'select', options: [
        { value: '1', label: 'Very Fast' }, { value: '2', label: 'Fast' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'Slow' }, { value: '5', label: 'Very Slow' },
      ]},
      { key: 'NatureAbundance', label: 'Nature Abundance', type: 'select', options: [
        { value: '1', label: 'Very Poor' }, { value: '2', label: 'Poor' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'Abundant' }, { value: '5', label: 'Very Abundant' },
      ]},
      { key: 'ErosionSpeed', label: 'Erosion Speed', type: 'select', options: [
        { value: '1', label: 'Very Fast (20 days)' }, { value: '2', label: 'Fast (50 days)' },
        { value: '3', label: 'Normal (100 days)' }, { value: '4', label: 'Slow (200 days)' },
        { value: '5', label: 'Very Slow (500 days)' },
      ]},
      { key: 'Farming', label: 'Farming Speed', type: 'select', options: [
        { value: '1', label: 'Very Fast' }, { value: '2', label: 'Fast' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'Slow' }, { value: '5', label: 'Very Slow' },
      ]},
      { key: 'CompostTime', label: 'Compost Time', type: 'select', options: [
        { value: '1', label: '1 week' }, { value: '2', label: '2 weeks' }, { value: '3', label: '3 weeks' },
        { value: '4', label: '4 weeks' }, { value: '5', label: '6 weeks' }, { value: '6', label: '8 weeks' },
      ]},
      { key: 'InjurySeverity', label: 'Injury Severity', type: 'select', options: [
        { value: '1', label: 'Low' }, { value: '2', label: 'Normal' }, { value: '3', label: 'High' },
      ]},
      { key: 'BoneFracture', label: 'Bone Fractures', type: 'bool' },
      { key: 'BloodLevel', label: 'Bleed Severity', type: 'select', options: [
        { value: '1', label: 'None' }, { value: '2', label: 'Low' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'High' }, { value: '5', label: 'Very High' },
      ]},
      { key: 'ClothingDegradation', label: 'Clothing Degradation', type: 'select', options: [
        { value: '1', label: 'Disabled' }, { value: '2', label: 'Slow' }, { value: '3', label: 'Normal' }, { value: '4', label: 'Fast' },
      ]},
      { key: 'FireSpread', label: 'Fire Spread', type: 'bool' },
      { key: 'MultiHitZombies', label: 'Multi-Hit Zombies (melee)', type: 'bool' },
      { key: 'CharacterFreePoints', label: 'Free Trait Points', type: 'number' },
    ],
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    icon: Car,
    fields: [
      { key: 'EnableVehicles', label: 'Vehicles Enabled', type: 'bool' },
      { key: 'CarSpawnRate', label: 'Car Spawn Rate', type: 'select', options: [
        { value: '1', label: 'None' }, { value: '2', label: 'Low' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'High' }, { value: '5', label: 'Insane' },
      ]},
      { key: 'ChanceHasGas', label: 'Chance Has Gas', type: 'select', options: [
        { value: '1', label: 'Low' }, { value: '2', label: 'Normal' }, { value: '3', label: 'High' },
      ]},
      { key: 'InitialGasoline', label: 'Initial Gasoline', type: 'select', options: [
        { value: '1', label: 'Empty' }, { value: '2', label: 'Very Low' }, { value: '3', label: 'Low' },
        { value: '4', label: 'Normal' }, { value: '5', label: 'Full' },
      ]},
      { key: 'FuelConsumption', label: 'Fuel Consumption', type: 'float' },
      { key: 'LockedCar', label: 'Locked Cars', type: 'select', options: [
        { value: '1', label: 'Very Often' }, { value: '2', label: 'Often' }, { value: '3', label: 'Sometimes' },
        { value: '4', label: 'Rarely' }, { value: '5', label: 'Never' },
      ]},
      { key: 'CarGeneralCondition', label: 'Vehicle Condition', type: 'select', options: [
        { value: '1', label: 'Very Low' }, { value: '2', label: 'Low' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'High' },
      ]},
      { key: 'CarDamageOnImpact', label: 'Damage on Impact', type: 'select', options: [
        { value: '1', label: 'Very Low' }, { value: '2', label: 'Low' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'High' }, { value: '5', label: 'Very High' },
      ]},
      { key: 'TrafficJam', label: 'Traffic Jams Spawn', type: 'bool' },
      { key: 'CarAlarm', label: 'Car Alarm Frequency', type: 'select', options: [
        { value: '1', label: 'Very Rare' }, { value: '2', label: 'Rare' }, { value: '3', label: 'Normal' },
        { value: '4', label: 'Often' }, { value: '5', label: 'Very Often' },
      ]},
      { key: 'PlayerDamageFromCrash', label: 'Player Damage From Crash', type: 'bool' },
      { key: 'VehicleEasyUse', label: 'Easy Use Vehicles', type: 'bool' },
    ],
  },
  {
    id: 'safehouse',
    label: 'Safehouses & PvP',
    icon: Home,
    fields: [
      { key: 'Faction', label: 'Factions Enabled', type: 'bool' },
      { key: 'FactionDaySurvivedToCreate', label: 'Days to Create Faction', type: 'float' },
      { key: 'FactionPlayersRequiredForTag', label: 'Players Needed for Tag', type: 'number' },
      { key: 'AllowTents', label: 'Tents Allowed', type: 'bool' },
      { key: 'SafehouseAllowTrepass', label: 'Safehouse Trespass', type: 'bool' },
      { key: 'SafehouseAllowFire', label: 'Safehouse Fire Damage', type: 'bool' },
      { key: 'SafehouseAllowLoot', label: 'Safehouse Looting', type: 'bool' },
      { key: 'SafehouseAllowRespawn', label: 'Allow Respawn at Safehouse', type: 'bool' },
      { key: 'SafehouseDaySurvivedToClaim', label: 'Days to Claim Safehouse', type: 'float' },
      { key: 'SafeHouseRemovalTime', label: 'Inactive Removal Hours', type: 'number' },
      { key: 'SafehouseAllowNonResidential', label: 'Non-Residential Safehouses', type: 'bool' },
      { key: 'AllowDestructionBySledgehammer', label: 'Allow Sledgehammer Destruction', type: 'bool' },
      { key: 'SledgehammerOnlyInSafehouse', label: 'Sledgehammer Only in Safehouse', type: 'bool' },
      { key: 'KickFastPlayers', label: 'Kick Fast Players (anti-cheat)', type: 'bool' },
    ],
  },
]

export default function Sandbox() {
  const [vars, setVars] = useState<Record<string, string>>({})
  const [originalVars, setOriginalVars] = useState<Record<string, string>>({})
  const [rawLua, setRawLua] = useState('')
  const [tab, setTab] = useState<'form' | 'raw'>('form')
  const [activeGroup, setActiveGroup] = useState(fieldGroups[0].id)
  const [saved, setSaved] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.getSandbox()
      if (res.success) {
        setVars(res.vars || {})
        setOriginalVars(res.vars || {})
        setRawLua(res.raw || '')
      } else {
        setError(res.error || 'Failed to load SandboxVars.lua')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(vars), ...Object.keys(originalVars)])
    for (const k of keys) if (vars[k] !== originalVars[k]) return true
    return false
  }, [vars, originalVars])

  const setVal = (key: string, val: string) =>
    setVars((prev) => ({ ...prev, [key]: val }))

  const resetField = (key: string) => {
    if (key in originalVars) setVars((prev) => ({ ...prev, [key]: originalVars[key] }))
  }

  const handleSaveForm = async () => {
    const res = await window.electronAPI.saveSandbox(vars)
    if (res.success) {
      setSaved('Sandbox vars saved. Restart server for changes to take effect.')
      setOriginalVars(vars)
      setTimeout(() => setSaved(null), 4000)
      // Refresh raw view
      const r = await window.electronAPI.getSandbox()
      if (r.success) setRawLua(r.raw || '')
    } else {
      setError(res.error || 'Save failed')
    }
  }

  const handleSaveRaw = async () => {
    const res = await window.electronAPI.saveSandboxRaw(rawLua)
    if (res.success) {
      setSaved('Raw Lua saved. Restart server for changes to take effect.')
      setTimeout(() => setSaved(null), 4000)
      load()
    } else {
      setError(res.error || 'Save failed')
    }
  }

  if (loading) return <div className="text-[#a0a0a0]">Loading sandbox vars…</div>
  if (error) return (
    <div className="card border-red-500/30 bg-red-500/10">
      <h3 className="font-semibold text-red-400 mb-2">Couldn't load SandboxVars.lua</h3>
      <p className="text-sm text-[#a0a0a0] mb-3">{error}</p>
      <button onClick={load} className="btn-secondary text-sm">Retry</button>
    </div>
  )

  const renderField = (f: Field) => {
    const value = vars[f.key] ?? ''
    const isDirty = originalVars[f.key] !== undefined && originalVars[f.key] !== value

    return (
      <div key={f.key} className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm text-[#a0a0a0]">{f.label}</label>
          <div className="flex items-center gap-2">
            {isDirty && (
              <button onClick={() => resetField(f.key)} title="Reset" className="text-[#666] hover:text-[#a0a0a0]">
                <RotateCcw size={12} />
              </button>
            )}
            <span className="text-[10px] text-[#666] font-mono">{f.key}</span>
          </div>
        </div>
        {f.type === 'select' && f.options ? (
          <select
            value={value}
            onChange={(e) => setVal(f.key, e.target.value)}
            className="input w-full"
          >
            <option value="">— unset —</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label} ({o.value})</option>
            ))}
          </select>
        ) : f.type === 'bool' ? (
          <select
            value={value}
            onChange={(e) => setVal(f.key, e.target.value)}
            className="input w-full"
          >
            <option value="">— unset —</option>
            <option value="true">Enabled (true)</option>
            <option value="false">Disabled (false)</option>
          </select>
        ) : (
          <input
            type={f.type === 'number' || f.type === 'float' ? 'number' : 'text'}
            step={f.type === 'float' ? '0.1' : '1'}
            value={value}
            onChange={(e) => setVal(f.key, e.target.value)}
            className="input w-full"
          />
        )}
        {f.help && <p className="text-xs text-[#666]">{f.help}</p>}
      </div>
    )
  }

  const activeFields = fieldGroups.find((g) => g.id === activeGroup)?.fields || []

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Skull size={20} />
            Sandbox / Gameplay
          </h2>
          <p className="text-sm text-[#a0a0a0] mt-1">
            Zombie behaviour, loot rates, world settings — written to <code className="text-[#888]">servertest_SandboxVars.lua</code>.
          </p>
        </div>
        <div className="flex bg-[#222] rounded-md p-0.5">
          <button
            onClick={() => setTab('form')}
            className={`px-3 py-1 rounded text-sm ${tab === 'form' ? 'bg-[#333] text-white' : 'text-[#a0a0a0]'}`}
          >
            Form
          </button>
          <button
            onClick={() => setTab('raw')}
            className={`px-3 py-1 rounded text-sm flex items-center gap-1 ${tab === 'raw' ? 'bg-[#333] text-white' : 'text-[#a0a0a0]'}`}
          >
            <FileText size={14} />
            Raw Lua
          </button>
        </div>
      </div>

      {tab === 'form' ? (
        <div className="grid grid-cols-[200px_1fr] gap-4">
          {/* Group sidebar */}
          <aside className="space-y-1">
            {fieldGroups.map((g) => {
              const Icon = g.icon
              const isActive = activeGroup === g.id
              return (
                <button
                  key={g.id}
                  onClick={() => setActiveGroup(g.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-all ${
                    isActive
                      ? 'bg-[#1f1f1f] text-white border-l-[3px] border-red-500'
                      : 'text-[#a0a0a0] hover:bg-[#222] hover:text-white'
                  }`}
                >
                  <Icon size={16} />
                  {g.label}
                </button>
              )
            })}
          </aside>

          {/* Fields */}
          <div className="card">
            <div className="grid grid-cols-2 gap-4">
              {activeFields.map(renderField)}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={rawLua}
            onChange={(e) => setRawLua(e.target.value)}
            className="textarea w-full h-[600px]"
            spellCheck={false}
          />
          <p className="text-xs text-[#666]">
            Edit the raw Lua. The form view will re-parse after save.
          </p>
        </div>
      )}

      {/* Save bar */}
      <div className="sticky bottom-0 bg-[#0f0f0f] border-t border-[#333] -mx-6 px-6 py-3 flex items-center gap-3">
        <button
          onClick={tab === 'form' ? handleSaveForm : handleSaveRaw}
          disabled={tab === 'form' && !dirty}
          className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Save size={16} /> Save
        </button>
        <button onClick={load} className="btn-secondary text-sm">Reload from disk</button>
        {dirty && tab === 'form' && (
          <span className="text-amber-400 text-sm">Unsaved changes</span>
        )}
        {saved && <span className="text-green-500 text-sm">{saved}</span>}
      </div>
    </div>
  )
}
