import { switchColor } from "@/scripts/main"
import { Tabs, TabsTrigger, TabsList } from "@/components/ui/tabs"
import { RiBrush3Line, RiFileImageLine, RiSettings2Line, RiSipLine } from "@remixicon/react"
import PressySquare from "./PressySquare"
import { useEffect, useState, useRef } from "react"

function contrastingColor (color : string) {
    color = color.replace("#", "")
    let r = parseInt(color.substring(0, 2), 16)
    let g = parseInt(color.substring(2, 4), 16)
    let b = parseInt(color.substring(4, 6), 16)

    let brightness = (r * 299 + g * 587 + b * 114) / 1000
    return brightness < 128
}

export default function ColorSwitcher( ) {
  let colors = ["#ffffff", "#ff0000", "#00ff00", "#0000ff", "#000000"]

  let [active, setActive] = useState("#ffffff")
  let [customColor, setCustomColor] = useState("#FFFF00")
  const colorInputRef = useRef<HTMLInputElement>(null)

  const handleCustomColorClick = () => {
    setActive("custom")
    colorInputRef.current?.click()
  }

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomColor(e.target.value)
  }
  
  useEffect(() => {
    if (active === "custom") {

      switchColor(customColor)
      return
    }
    switchColor(active)
  }, [active, customColor])

  return (
    <div className="flex space-x-1 bg-accent p-1">
      {
        colors.map((value) => (
          <PressySquare key={value} onClick={() => setActive(value)} active={active === value}>
            <div style={{ backgroundColor: value }} className="w-full h-full"></div>
          </PressySquare>
        ))
      }
      <PressySquare onClick={handleCustomColorClick} active={active === "custom"}>
        < RiSipLine className={`m-auto w-full h-full transition-all ${(active === "custom") ? (contrastingColor(customColor) ? "text-white" : "text-black") : (contrastingColor(customColor) ? "hover:text-white text-gray-450" : "hover:text-black text-gray-700")}`} style={{ backgroundColor: customColor }} />
        <input 
          ref={colorInputRef} 
          type="color" 
          value={customColor} 
          onChange={handleColorChange}
          className="invisible relative w-full h-full -top-full"
        />
      </PressySquare>
      
    </div>
  )
}
