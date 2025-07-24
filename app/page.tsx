"use client"

import createClient from "@/lib/supabase/client"

export default function Home() {

  const supabase = createClient()

  async function handlePost() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    })
  }

  async function handleGet() {
    const { data: { user } } = await supabase.auth.getUser()

    const id = user?.id
    fetch('/api/users/fetch?google_id=' + id)
    .then(res => {return res.json()})
    .then(data => {
      console.log(data)
    })
    
  }


  return (
    <div className="font-sans grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
      <p>checking out stuff</p>
      <button
        className="bg-white text-black p-2"
        onClick={() => {
          handlePost()
        }}
      >trigger post</button>

      <button
        className="bg-white text-black p-2"
        onClick={() => {
          handleGet()
        }}
      >trigger get</button>
    </div>
  );
}
