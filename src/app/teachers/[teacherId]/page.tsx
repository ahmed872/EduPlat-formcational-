import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  getTeacherProfile,
  readContactInfo,
  readLocations,
  readSocialLinks,
} from "@/lib/business/teacher-profile";

export default async function PublicTeacherProfilePage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const { teacherId } = await params;
  const { profile, courses } = await getTeacherProfile(prisma, teacherId);
  if (!profile) notFound();

  const socialLinks = readSocialLinks(profile.socialLinks);
  const contactInfo = readContactInfo(profile.contactInfo);
  const locations = readLocations(profile.locations);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <div className="flex items-center gap-4">
        {profile.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.photoUrl}
            alt={profile.user.name}
            className="h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200 text-2xl">
            {profile.user.name.charAt(0)}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">{profile.user.name}</h1>
          {profile.education && <p className="text-sm text-gray-600">{profile.education}</p>}
        </div>
      </div>

      {profile.bio && (
        <div>
          <h2 className="mb-1 font-semibold">نبذة</h2>
          <p className="text-sm text-gray-700">{profile.bio}</p>
        </div>
      )}
      {profile.experience && (
        <div>
          <h2 className="mb-1 font-semibold">الخبرة</h2>
          <p className="text-sm text-gray-700">{profile.experience}</p>
        </div>
      )}
      {profile.philosophy && (
        <div>
          <h2 className="mb-1 font-semibold">فلسفة التدريس</h2>
          <p className="text-sm text-gray-700">{profile.philosophy}</p>
        </div>
      )}

      {locations.length > 0 && (
        <div data-section="locations">
          <h2 className="mb-1 font-semibold">أماكن ومواعيد التدريس</h2>
          <ul className="flex flex-col gap-1 text-sm text-gray-700">
            {locations.map((location, i) => (
              <li key={i}>
                <span className="font-medium">{location.name}</span>
                {location.address && <span> — {location.address}</span>}
                {location.schedule && (
                  <span className="text-gray-500"> ({location.schedule})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(contactInfo || socialLinks.length > 0) && (
        <div data-section="contact">
          <h2 className="mb-1 font-semibold">التواصل</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {contactInfo?.email && (
              <li>
                البريد:{" "}
                <a href={`mailto:${contactInfo.email}`} dir="ltr" className="text-indigo-600 hover:underline">
                  {contactInfo.email}
                </a>
              </li>
            )}
            {contactInfo?.phone && (
              <li>
                الهاتف:{" "}
                <a href={`tel:${contactInfo.phone.replace(/[\s-]/g, "")}`} dir="ltr" className="text-indigo-600 hover:underline">
                  {contactInfo.phone}
                </a>
              </li>
            )}
            {contactInfo?.whatsapp && (
              <li>
                واتساب: <span dir="ltr">{contactInfo.whatsapp}</span>
              </li>
            )}
            {socialLinks.map((link, i) => (
              <li key={i}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-indigo-600 hover:underline"
                >
                  {link.platform}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-2 font-semibold">الكورسات المنشورة ({courses.length})</h2>
        <div className="flex flex-col gap-2">
          {courses.map((course) => (
            <div key={course.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
              {course.title} — <span className="text-gray-500">{course.category.name}</span>
            </div>
          ))}
          {courses.length === 0 && (
            <p className="text-sm text-gray-500">لا توجد كورسات منشورة بعد.</p>
          )}
        </div>
      </div>
    </main>
  );
}
