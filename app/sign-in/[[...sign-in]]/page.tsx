import { SignIn } from "@clerk/nextjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="justify-between bg-primary text-primary-foreground">
          <CardHeader className="gap-6">
            <div className="grid size-20 place-items-center border border-primary-foreground/40 font-heading text-3xl font-bold">
              rb
            </div>
            <div className="flex flex-col gap-3">
              <CardTitle className="font-heading text-5xl leading-tight">
                Welcome back to your shelf.
              </CardTitle>
              <CardDescription className="max-w-md text-base leading-7 text-primary-foreground/80">
                Sign in to keep making cozy books from videos and return to the
                reads you already saved.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-2xl">Sign in</CardTitle>
            <CardDescription>Open your private readabook shelf.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <SignIn />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
