export default function PressySquare({ onClick , active, children } : { onClick : () => void, active : boolean, children : React.ReactNode }) {
    return (
        <button className={`w-10.5 h-10.5 bg-accent ${active ? "text-foreground" : "text-muted-foreground"} transition-all hover:text-foreground duration-75`} onClick={onClick}>
            <div className={`w-fit h-fit m-auto ${active ? "border-3 bg-primary" : "bg-accent"} transition-all`}>
            <div className="w-8 h-8 m-0.5">
                {children}
            </div>
            </div>
        </button>
    )
}