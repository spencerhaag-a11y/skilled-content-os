import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-display text-6xl text-muted-foreground/30">404</p>
      <p className="text-muted-foreground">That page doesn't exist.</p>
      <Link to="/" className={buttonVariants()}>
        Back to dashboard
      </Link>
    </div>
  );
}
