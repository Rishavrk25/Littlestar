const productImages = [
  ['girl-01','girl-02','girl-03','girl-04','girl-05','girl-01','girl-02','girl-04'],
  ['boy-01','boy-02','boy-03','boy-01','boy-02','boy-03','boy-01','boy-02'],
  ['baby-01','baby-02','baby-03','baby-01','baby-02','baby-03','baby-01','baby-02'],
]
const names = [
  ['Floral Dream Frock', 'Princess Party Dress', 'Rainbow Cotton Dress', 'Little Diva Frock', 'Festive Lehenga Set', 'Denim Day Dress', 'Butterfly Party Frock', 'Floral Casual Set'],
  ['Little Explorer Tee', 'Mini Gentleman Shirt', 'Denim Dashing Set', 'Cool Dude Tee', 'Festive Kurta Set', 'Adventure Shorts Set', 'Classic Polo Set', 'Little Champ Outfit'],
  ['Tiny Star Romper', 'Cloud Baby Onesie', 'Little Bear Set', 'Rainbow Romper', 'Baby Princess Dress', 'Mini Explorer Set', 'Soft Cotton Jumpsuit', 'Little Moon Romper'],
]
const groups = [
  { category: 'Girls', subcategory: 'Dresses', sizes: ['3-4Y','4-5Y','5-6Y','6-7Y','8-9Y','10-11Y','12-13Y','14-15Y'], ages: ['2–5','5–8','8–12','12–15'], colors: ['Rose','Lilac','Butter yellow'], occasions: ['Birthday','Wedding','Festival','Family Day'] },
  { category: 'Boys', subcategory: 'Sets', sizes: ['3-4Y','4-5Y','5-6Y','6-7Y','8-9Y','10-11Y','12-13Y','14-15Y'], ages: ['2–5','5–8','8–12','12–15'], colors: ['Sky blue','Navy','Sage'], occasions: ['Playground','School Event','Family Day','Birthday'] },
  { category: 'Baby', subcategory: 'One-pieces', sizes: ['0-3M','3-6M','6-9M','9-12M'], ages: ['0–2'], colors: ['Cloud white','Mint','Powder blue'], occasions: ['Baby Shower','Family Day','Everyday','Birthday'] },
]
const descriptions = [
  'A soft, swishy little favourite made for twirling through the day. Thoughtful details and a comfy lining make every moment feel special.',
  'Easy to wear, easy to love. This breathable everyday piece keeps little explorers comfortable from the first adventure to the last.',
  'Gentle on new skin and made for the coziest cuddles. A sweet, practical layer for tiny days and even tinier toes.',
]

export const products = names.flatMap((list, groupIndex) => list.map((name, itemIndex) => {
  const id = `${['g','b','baby'][groupIndex]}${itemIndex + 1}`
  const price = [899, 1199, 999, 799, 1599, 1099, 1299, 1399][itemIndex]
  const grpColors = groups[groupIndex].colors
  const colorImages = groupIndex === 0
    ? [
        { color: grpColors[0], images: [`/assets/products/${productImages[0][itemIndex]}.jpg`, '/assets/products/girl-04.jpg'] },
        { color: grpColors[1], images: ['/assets/products/girl-02.jpg', '/assets/products/girl-05.jpg'] },
        { color: grpColors[2], images: ['/assets/products/girl-03.jpg'] }
      ]
    : groupIndex === 1
    ? [
        { color: grpColors[0], images: [`/assets/products/${productImages[1][itemIndex]}.jpg`] },
        { color: grpColors[1], images: ['/assets/products/boy-02.jpg'] },
        { color: grpColors[2], images: ['/assets/products/boy-03.jpg'] }
      ]
    : [
        { color: grpColors[0], images: [`/assets/products/${productImages[2][itemIndex]}.jpg`] },
        { color: grpColors[1], images: ['/assets/products/baby-02.jpg'] },
        { color: grpColors[2], images: ['/assets/products/baby-03.jpg'] }
      ]
  const allImages = [...new Set(colorImages.flatMap((c) => c.images))]
  const product = {
    id, name, description: descriptions[groupIndex], ...groups[groupIndex],
    price, originalPrice: Math.round(price * (itemIndex % 3 === 0 ? 1.25 : 1.18)),
    discount: itemIndex % 3 === 0 ? 20 : 15,
    images: allImages,
    colorImages,
    sizes: groups[groupIndex].sizes, colors: groups[groupIndex].colors,
    ageRange: groups[groupIndex].ages, occasion: groups[groupIndex].occasions,
    material: groupIndex === 2 ? '100% gentle cotton' : 'Soft cotton blend',
    rating: itemIndex % 2 ? 4.7 : 4.8, reviews: 32 + itemIndex * 13,
    featured: itemIndex < 3, newArrival: itemIndex === 0 || itemIndex === 3,
    stock: 12 + itemIndex * 3, tags: itemIndex % 2 ? ['Everyday','Soft'] : ['Bestseller','Play-ready'],
  }
  return product
}))

export const moods = [
  { title: 'PLAY DAY', note: 'Ready, set, explore', color: 'mint', image: 'photo-1471286174890-9c112ffca5b4', category: 'Boys' },
  { title: 'PARTY TIME', note: 'A little extra sparkle', color: 'pink', image: 'photo-1503454537195-1dcabb73ffb9', category: 'Girls' },
  { title: 'LITTLE PRINCE', note: 'Smart looks, big smiles', color: 'blue', image: 'photo-1519238263530-99bdd11df2ea', category: 'Boys' },
  { title: 'LITTLE PRINCESS', note: 'Made for twirling', color: 'yellow', image: '/assets/products/girl-01.jpg', category: 'Girls' },
  { title: 'FESTIVE FUN', note: 'Dressed for the moment', color: 'lavender', image: '/assets/products/girl-03.jpg', category: 'Girls' },
  { title: 'WEEKEND MODE', note: 'Comfy looks, all day', color: 'sky', image: '/assets/products/baby-01.jpg', category: 'Baby' },
]

export const imageUrl = (id, width = 1000) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`
