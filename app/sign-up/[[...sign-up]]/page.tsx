import { SignUp } from "@clerk/nextjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignUpPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="justify-between bg-accent text-accent-foreground">
          <CardHeader className="gap-6">
            <div className="grid size-20 place-items-center border border-accent-foreground/40 font-heading text-3xl font-bold">
              rb
            </div>
            <div className="flex flex-col gap-3">
              <CardTitle className="font-heading text-5xl leading-tight">
                Start a tiny library of your own.
              </CardTitle>
              <CardDescription className="max-w-md text-base leading-7 text-accent-foreground/80">
                Create an account, paste a video, and let readabook shape the
                transcript into a saved book.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-2xl">Create account</CardTitle>
            <CardDescription>Save every finished book to your shelf.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <SignUp />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
