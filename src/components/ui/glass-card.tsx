import { cn } from "@/lib/utils"
import * as React from "react"

function GlassCard({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="glass-card"
            className={cn(
                "bg-primary-foreground/30 border-primary-foreground/30 flex flex-col gap-6 rounded-2xl border py-6 text-white backdrop-blur-md",
                className,
            )}
            {...props}
        />
    )
}

function GlassCardHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="glass-card-header"
            className={cn(
                "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-5 has-data-[slot=glass-card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
                className,
            )}
            {...props}
        />
    )
}

function GlassCardTitle({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="glass-card-title"
            className={cn("leading-none font-semibold", className)}
            {...props}
        />
    )
}

function GlassCardDescription({
    className,
    ...props
}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="glass-card-description"
            className={cn("text-sm", className)}
            {...props}
        />
    )
}

function GlassCardAction({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="glass-card-action"
            className={cn(
                "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
                className,
            )}
            {...props}
        />
    )
}

function GlassCardContent({
    className,
    ...props
}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="glass-card-content"
            className={cn("px-5", className)}
            {...props}
        />
    )
}

function GlassCardFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="glass-card-footer"
            className={cn("flex items-center px-5 [.border-t]:pt-6", className)}
            {...props}
        />
    )
}
export {
    GlassCard,
    GlassCardHeader,
    GlassCardTitle,
    GlassCardDescription,
    GlassCardAction,
    GlassCardContent,
    GlassCardFooter,
}
