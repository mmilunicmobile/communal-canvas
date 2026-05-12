import { switchPage } from "@/scripts/main"
import { Tabs, TabsTrigger, TabsList } from "@/components/ui/tabs"
import { RiBrush3Line, RiFileImageLine, RiSettings2Line } from "@remixicon/react"
import PressySquare from "./PressySquare"
import { useEffect, useState } from "react"

export default function PageSwitcher( ) {
  let [active, setActive] = useState("paint")
  
  useEffect(() => {
    switchPage(active)
  }, [active])

  return (
    <div className="flex space-x-1 bg-accent p-1">
      <PressySquare onClick={() => setActive("paint")} active={active === "paint"}><RiBrush3Line className="w-full h-full"/></PressySquare>
      <PressySquare onClick={() => setActive("images")} active={active === "images"} ><RiFileImageLine className="w-full h-full"/></PressySquare>
      <PressySquare onClick={() => setActive("settings")} active={active === "settings"} ><RiSettings2Line className="w-full h-full"/></PressySquare>
    </div>
  )
}
