import { switchColor } from "@/scripts/main"
import { Tabs, TabsTrigger, TabsList } from "@/components/ui/tabs"
import { RiBrush3Line, RiFileImageLine, RiSettings2Line, RiSipLine, RiSquareFill } from "@remixicon/react"
import { useState } from "react"

const colorSwatches = [ "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#000000"]

export default function TopTabs() {
  const [customColor, setCustomColor] = useState("#cccccc")

  return (
    <Tabs onValueChange={switchColor} defaultValue="white">
      <TabsList className="">
        {colorSwatches.map((value) => (
          <TabsTrigger
            key={value}
            value={value}
          >
            < RiSquareFill  color={value} />
          </TabsTrigger>
          
        ))}
        <TabsTrigger
            key="custom"
            value="custom"
           >
            <RiSipLine />
           </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
