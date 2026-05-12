import { switchPage } from "@/scripts/main"
import { Tabs, TabsTrigger, TabsList } from "@/components/ui/tabs"
import { RiBrush3Line, RiFileImageLine, RiSettings2Line } from "@remixicon/react"
import PressySquare from "./PressySquare"
import { useEffect, useState } from "react"
import { state } from "@/scripts/main"

export default function PageSwitcher( ) {
  let [active, setActive] = useState("paint")
  let [connected, setConnected] = useState(false)

  useEffect(() => {
    const syncConnectionState = () => {
      setConnected(state.ws?.readyState === WebSocket.OPEN)
    }

    syncConnectionState()
    const intervalId = setInterval(syncConnectionState, 250)

    return () => clearInterval(intervalId)
  }, [])
  
  useEffect(() => {
    switchPage(active)
  }, [active])

  return (
    <div className="flex space-x-1 bg-accent p-1">
      
      <PressySquare onClick={() => setActive("paint")} active={active === "paint"}><RiBrush3Line className="w-full h-full"/></PressySquare>
      <PressySquare onClick={() => setActive("images")} active={active === "images"} ><RiFileImageLine className="w-full h-full"/></PressySquare>
      <PressySquare onClick={() => setActive("settings")} active={active === "settings"} ><RiSettings2Line className="w-full h-full"/></PressySquare>
      <div className="flex items-center justify-center px-2">
        <span
          className={`h-3 w-3 border rounded-full  ${connected ? "bg-emerald-500" : "bg-red-500"}`}
          aria-label={connected ? "Connected" : "Disconnected"}
          title={connected ? "Connected" : "Disconnected"}
        />
      </div>
    </div>
  )
}
